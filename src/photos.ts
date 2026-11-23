import { openDB, type DBSchema } from 'idb';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type PhotoMode = 'demo' | 'live';
export type PhotoOwner = 'shop' | 'invoice' | 'cheque';
export interface PhotoRecord {
  id: string;
  mode: PhotoMode;
  ownerType: PhotoOwner;
  ownerId: string;
  deviceId: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
  /** Included in a generated ZIP or restored from a ZIP, never cloud backed. */
  backedUpAt?: string;
}
export interface PhotoMetadata {
  mode: PhotoMode;
  ownerType: PhotoOwner;
  ownerId: string;
  deviceId: string;
  id?: string;
}
interface StoredPhoto extends PhotoRecord { key: string; blob: Blob }
interface PhotoDB extends DBSchema {
  photos: { key: string; value: StoredPhoto; indexes: { mode: PhotoMode } };
}
interface BackupPhoto extends PhotoRecord { path: string }
interface PhotoManifest { version: 1; app: 'Saman Indika Ledger'; mode: PhotoMode; exportedAt: string; photos: BackupPhoto[] }
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_PHOTOS = 1000;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/gif': 'gif' };
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
let database: ReturnType<typeof openDB<PhotoDB>> | undefined;
function db() {
  return database ??= openDB<PhotoDB>('si-ledger-photos-v1', 1, {
    upgrade(database) { database.createObjectStore('photos', { keyPath: 'key' }).createIndex('mode', 'mode'); },
  });
}
function assertMode(mode: PhotoMode): void { if (mode !== 'demo' && mode !== 'live') throw new Error('Choose demo or live photo storage.'); }
function assertId(value: string): void { if (typeof value !== 'string' || (!IDENTIFIER.test(value) || value.includes('..'))) throw new Error('Invalid photo link identifier.'); }
function assertMetadata(meta: PhotoMetadata): void {
  assertMode(meta.mode); assertId(meta.ownerId); assertId(meta.deviceId);
  if (meta.id) assertId(meta.id);
  if (!['shop', 'invoice', 'cheque'].includes(meta.ownerType)) throw new Error('Invalid photo owner.');
}
function key(id: string, mode: PhotoMode): string { assertId(id); assertMode(mode); return `${mode}:${id}`; }
function withoutBlob(record: StoredPhoto): PhotoRecord {
  const { blob: _blob, key: _key, ...metadata } = record;
  return metadata;
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, n => n.toString(16).padStart(2, '0')).join('');
}
function storageError(error: unknown): Error {
  if (error instanceof Error && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) return new Error('This phone could not store the photo. Free space or export a backup before trying again.');
  return error instanceof Error ? error : new Error('Photo storage failed.');
}
function inferMime(file: Blob): string {
  if (MIME_EXT[file.type.toLowerCase()]) return file.type.toLowerCase();
  if (file.type && file.type !== 'application/octet-stream') throw new Error('Choose a JPEG, PNG, WebP, HEIC, HEIF, AVIF or GIF photo.');
  const extension = ('name' in file ? String(file.name).split('.').pop() : '')?.toLowerCase();
  const found = Object.entries(MIME_EXT).find(([, ext]) => ext === extension || (ext === 'jpg' && extension === 'jpeg'));
  if (!found) throw new Error('This image format is not supported. Choose a camera photo.');
  return found[0];
}
export async function savePhoto(file: Blob, metadata: PhotoMetadata): Promise<PhotoRecord> {
  assertMetadata(metadata);
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Each photo must be between 1 byte and 25 MB.');
  const mime = inferMime(file);
  const id = metadata.id ?? crypto.randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await digest(bytes);
  const record: StoredPhoto = {
    ...metadata, id, key: key(id, metadata.mode), name: ('name' in file ? String(file.name) : `receipt.${MIME_EXT[mime]}`).slice(0, 255),
    mime, size: file.size, sha256, createdAt: new Date().toISOString(), blob: file,
  };
  try {
    const database = await db();
    const tx = database.transaction('photos', 'readwrite');
    const existing = await tx.store.get(record.key);
    if (existing) {
      if (existing.sha256 !== sha256 || existing.ownerType !== record.ownerType || existing.ownerId !== record.ownerId) { tx.abort(); await tx.done.catch(() => undefined); throw new Error('This photo ID already belongs to a different photo.'); }
      await tx.done;
      return withoutBlob(existing);
    }
    await tx.store.add(record);
    await tx.done;
    return withoutBlob(record);
  } catch (error) { throw storageError(error); }
}
export async function getPhoto(id: string, mode: PhotoMode = 'demo'): Promise<Blob | null> {
  return (await (await db()).get('photos', key(id, mode)))?.blob ?? null;
}
export async function listPhotos(mode: PhotoMode): Promise<PhotoRecord[]> {
  assertMode(mode);
  return (await (await db()).getAllFromIndex('photos', 'mode', mode)).map(withoutBlob).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function removePhoto(id: string, mode: PhotoMode): Promise<void> { await (await db()).delete('photos', key(id, mode)); }

export async function exportPhotos(mode: PhotoMode, selectedIds?: string[]): Promise<Blob> {
  assertMode(mode);
  const database = await db();
  const allPhotos = await database.getAllFromIndex('photos', 'mode', mode);
  const selection = selectedIds ? new Set(selectedIds) : null;
  const photos = selection ? allPhotos.filter(photo => selection.has(photo.id)) : allPhotos;
  if (selection && selection.size !== photos.length) throw new Error('Some selected photos are not available on this device.');
  if (photos.length > MAX_PHOTOS || photos.reduce((sum, photo) => sum + photo.size, 0) > MAX_ARCHIVE_BYTES - 1024 * 1024) throw new Error('This backup exceeds 200 MB. Export fewer photos at a time.');
  const exportedAt = new Date().toISOString();
  const manifest: PhotoManifest = { version: 1, app: 'Saman Indika Ledger', mode, exportedAt, photos: [] };
  const files: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const photo of photos) {
    const path = `photos/${photo.id}.${MIME_EXT[photo.mime]}`;
    files[path] = new Uint8Array(await photo.blob.arrayBuffer());
    manifest.photos.push({ ...withoutBlob(photo), backedUpAt: exportedAt, path });
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2)) as Uint8Array<ArrayBuffer>;
  const archive = zipSync(files, { level: 0 });
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('This backup exceeds the 200 MB limit.');
  const tx = database.transaction('photos', 'readwrite');
  for (const photo of photos) {
    const current = await tx.store.get(photo.key);
    if (current?.sha256 === photo.sha256) await tx.store.put({ ...current, backedUpAt: exportedAt });
  }
  await tx.done;
  return new Blob([archive as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** Inspect central/local headers before decompressing so corrupt files and ZIP bombs are rejected. */
function inspectZip(bytes: Uint8Array<ArrayBuffer>): Set<string> {
  if (bytes.length > MAX_ARCHIVE_BYTES || bytes.length < 22) throw new Error('Choose a valid photo backup ZIP under 200 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('The ZIP is incomplete or damaged.');
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true)
    || count > MAX_PHOTOS + 1 || count < 1 || offset + centralSize !== end) throw new Error('Unsupported ZIP structure.');
  const names = new Set<string>();
  let position = offset;
  let totalSize = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
    const flags = view.getUint16(position + 8, true);
    const compression = view.getUint16(position + 10, true);
    const size = view.getUint32(position + 24, true);
    const compressed = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const local = view.getUint32(position + 42, true);
    if (position + 46 + nameLength + extraLength + commentLength > end) throw new Error('The ZIP directory is damaged.');
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (!(name === 'manifest.json' || /^photos\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\.(jpg|png|webp|heic|heif|gif|avif)$/.test(name))
      || name.includes('..') || names.has(name)) throw new Error('The backup contains an unsafe or duplicate file path.');
    if ((flags & 1) || ![0, 8].includes(compression) || (view.getUint32(position + 38, true) >>> 16 & 0xf000) === 0xa000
      || size > (name === 'manifest.json' ? 1024 * 1024 : MAX_PHOTO_BYTES) || compressed > MAX_ARCHIVE_BYTES) throw new Error('The backup contains an unsupported or oversized file.');
    totalSize += size;
    if (totalSize > MAX_ARCHIVE_BYTES) throw new Error('The uncompressed backup exceeds 200 MB.');
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50) throw new Error('The ZIP photo header is damaged.');
    const localNameLength = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    if (local + 30 + localNameLength + localExtra + compressed > offset || view.getUint16(local + 6, true) !== flags
      || view.getUint16(local + 8, true) !== compression || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) throw new Error('The ZIP file headers do not match.');
    names.add(name);
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end || !names.has('manifest.json')) throw new Error('The photo manifest is missing.');
  return names;
}
function validTimestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
function parseManifest(bytes: Uint8Array, mode: PhotoMode): PhotoManifest {
  let manifest: PhotoManifest;
  try { manifest = JSON.parse(strFromU8(bytes)); } catch { throw new Error('The backup manifest is not valid JSON.'); }
  if (!manifest || manifest.version !== 1 || manifest.app !== 'Saman Indika Ledger' || manifest.mode !== mode
    || !validTimestamp(manifest.exportedAt) || !Array.isArray(manifest.photos) || manifest.photos.length > MAX_PHOTOS) throw new Error('Use a version 1 Saman Indika Ledger backup from the same demo/live mode.');
  const ids = new Set<string>();
  for (const photo of manifest.photos) {
    if (!photo || typeof photo !== 'object') throw new Error('The backup contains invalid photo metadata.');
    assertMetadata(photo);
    assertId(photo.id);
    if (photo.mode !== mode || ids.has(photo.id) || typeof photo.mime !== 'string' || !MIME_EXT[photo.mime]
      || photo.path !== `photos/${photo.id}.${MIME_EXT[photo.mime]}` || typeof photo.name !== 'string' || photo.name.length > 255
      || !Number.isSafeInteger(photo.size) || photo.size < 1 || photo.size > MAX_PHOTO_BYTES
      || !/^[a-f0-9]{64}$/.test(photo.sha256) || !validTimestamp(photo.createdAt)
      || (photo.backedUpAt !== undefined && !validTimestamp(photo.backedUpAt))) throw new Error('The backup contains invalid or duplicate photo metadata.');
    ids.add(photo.id);
  }
  return manifest;
}
export async function restorePhotos(file: Blob, mode: PhotoMode): Promise<{ restored: number; skipped: number }> {
  assertMode(mode);
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Choose a photo backup ZIP under 200 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const paths = inspectZip(bytes);
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('The ZIP could not be read. It may be damaged.'); }
  const manifest = parseManifest(files['manifest.json'], mode);
  if (paths.size !== manifest.photos.length + 1) throw new Error('The backup contains files that are not listed in its manifest.');
  const records: StoredPhoto[] = [];
  for (const photo of manifest.photos) {
    const bytes = files[photo.path];
    if (!bytes || bytes.byteLength !== photo.size || await digest(new Uint8Array(bytes)) !== photo.sha256) throw new Error(`Photo ${photo.id} failed its integrity check. Nothing was restored.`);
    const { path: _path, ...metadata } = photo;
    records.push({ ...metadata, key: key(photo.id, mode), backedUpAt: manifest.exportedAt, blob: new Blob([new Uint8Array(bytes)], { type: photo.mime }) });
  }
  const database = await db();
  const tx = database.transaction('photos', 'readwrite');
  let restored = 0;
  let skipped = 0;
  try {
    for (const record of records) {
      const existing = await tx.store.get(record.key);
      if (existing) {
        if (existing.sha256 !== record.sha256 || existing.ownerId !== record.ownerId || existing.ownerType !== record.ownerType) throw new Error('A photo ID already exists with different content. Nothing was restored.');
        skipped += 1;
      } else { await tx.store.add(record); restored += 1; }
    }
    await tx.done;
    return { restored, skipped };
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already have aborted. */ }
    await tx.done.catch(() => undefined);
    throw storageError(error);
  }
}
