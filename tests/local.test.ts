import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { changePin, getPinLockout, hasPin, resetPinAfterOwnerEnrollment, setPin, verifyPin } from '../src/pin';
import { exportPhotos, getPhoto, listPhotos, removePhoto, restorePhotos, savePhoto } from '../src/photos';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}
vi.stubGlobal('localStorage', new MemoryStorage());
const photo = (content = 'thermal receipt original') => new File([content], 'receipt.jpg', { type: 'image/jpeg' });
const metadata = (id: string) => ({ id, mode: 'demo' as const, ownerType: 'invoice' as const, ownerId: 'invoice-1', deviceId: 'capturing-phone' });
const zipBlob = (files: Record<string, Uint8Array>) => new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: 'application/zip' });
beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await listPhotos('demo'); // Initializes the shared schema.
  const database = await openDB('si-ledger-photos-v1', 1);
  await database.clear('photos');
  database.close();
});

describe('local six-digit profile screen lock', () => {
  it('stores a salted hash, separates profiles and demo/live, and never stores the PIN', async () => {
    expect(hasPin('demo', 'me')).toBe(false);
    await setPin('demo', 'me', '827461');
    await setPin('demo', 'brother', '827461');
    expect(hasPin('live', 'me')).toBe(false);
    expect((await verifyPin('demo', 'me', '827461')).ok).toBe(true);
    expect((await verifyPin('demo', 'brother', '000000')).ok).toBe(false);
    const first = localStorage.getItem('si-ledger:pin:v1:demo:me')!;
    const second = localStorage.getItem('si-ledger:pin:v1:demo:brother')!;
    expect(first).not.toContain('827461');
    expect(JSON.parse(first).salt).not.toEqual(JSON.parse(second).salt);
    expect(JSON.parse(first).hash).not.toEqual(JSON.parse(second).hash);
    await expect(setPin('demo', 'me', '123456')).rejects.toThrow('already exists');
    await expect(setPin('live', 'me', '12345')).rejects.toThrow('six digits');
  });
  it('persists cooldown after five attempts and rejects even the correct PIN until expiry', async () => {
    await setPin('live', 'me', '827461');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let i = 0; i < 5; i++) await verifyPin('live', 'me', '000000');
    expect(getPinLockout('live', 'me')).toBe(30);
    expect(await verifyPin('live', 'me', '827461')).toEqual({ ok: false, retryAfterSeconds: 30 });
    expect(JSON.parse(localStorage.getItem('si-ledger:pin:v1:live:me')!).failedAttempts).toBe(5);
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    expect(await verifyPin('live', 'me', '827461')).toEqual({ ok: true, retryAfterSeconds: 0 });
    expect(getPinLockout('live', 'me')).toBe(0);
  });
  it('requires the old PIN for a change and supports explicit post-enrolment local reset', async () => {
    await setPin('demo', 'me', '827461');
    await expect(changePin('demo', 'me', '000000', '123456')).rejects.toThrow('incorrect');
    await changePin('demo', 'me', '827461', '123456');
    expect((await verifyPin('demo', 'me', '827461')).ok).toBe(false);
    expect((await verifyPin('demo', 'me', '123456')).ok).toBe(true);
    await resetPinAfterOwnerEnrollment('demo', 'me', '654321');
    expect((await verifyPin('demo', 'me', '654321')).ok).toBe(true);
    expect(hasPin('live', 'me')).toBe(false);
  });
  it('does not silently remove a damaged PIN record', () => {
    localStorage.setItem('si-ledger:pin:v1:demo:me', '{"version":1}');
    expect(() => hasPin('demo', 'me')).toThrow('damaged');
  });
});

describe('local original photos and ZIP backups', () => {
  it('preserves original bytes and links through export/restore; mode isolation and retry are safe', async () => {
    const original = photo();
    await savePhoto(original, metadata('photo-1'));
    expect((await listPhotos('demo'))[0].backedUpAt).toBeUndefined();
    expect(await getPhoto('photo-1', 'live')).toBeNull();
    const backup = await exportPhotos('demo');
    const files = unzipSync(new Uint8Array(await backup.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.photos[0]).toMatchObject({ ownerId: 'invoice-1', deviceId: 'capturing-phone', path: 'photos/photo-1.jpg' });
    expect((await listPhotos('demo'))[0].backedUpAt).toBeTruthy();
    await removePhoto('photo-1', 'demo');
    expect(await restorePhotos(backup, 'demo')).toEqual({ restored: 1, skipped: 0 });
    expect(await (await getPhoto('photo-1', 'demo'))!.text()).toEqual(await original.text());
    expect(await restorePhotos(backup, 'demo')).toEqual({ restored: 0, skipped: 1 });
    await expect(restorePhotos(backup, 'live')).rejects.toThrow('same demo/live mode');
  });
  it('supports selected-photo backups and rejects accidental identifier reuse', async () => {
    await savePhoto(photo(), metadata('photo-1'));
    await savePhoto(photo('another receipt'), metadata('photo-2'));
    const selected = await exportPhotos('demo', ['photo-2']);
    const manifest = JSON.parse(strFromU8(unzipSync(new Uint8Array(await selected.arrayBuffer()))['manifest.json']));
    expect(manifest.photos.map((p: { id: string }) => p.id)).toEqual(['photo-2']);
    await expect(savePhoto(photo('different image'), metadata('photo-1'))).rejects.toThrow('already belongs');
    expect((await listPhotos('demo')).find(p => p.id === 'photo-1')?.backedUpAt).toBeUndefined();
  });
  it('rejects traversal paths, invalid manifests and corrupted photo content before storing anything', async () => {
    await expect(restorePhotos(zipBlob({ '../stolen.jpg': strToU8('x'), 'manifest.json': strToU8('{}') }), 'demo')).rejects.toThrow('unsafe');
    await expect(restorePhotos(zipBlob({ 'manifest.json': strToU8('{"version":99}') }), 'demo')).rejects.toThrow('version 1');
    await savePhoto(photo(), metadata('photo-1'));
    const backup = await exportPhotos('demo');
    await removePhoto('photo-1', 'demo');
    const files = unzipSync(new Uint8Array(await backup.arrayBuffer()));
    files['photos/photo-1.jpg'][0] ^= 1;
    await expect(restorePhotos(zipBlob(files), 'demo')).rejects.toThrow('integrity');
    expect(await listPhotos('demo')).toHaveLength(0);
  });
  it('restores atomically when an existing photo has conflicting content', async () => {
    await savePhoto(photo('first'), metadata('photo-1'));
    await savePhoto(photo('second'), metadata('photo-2'));
    const backup = await exportPhotos('demo');
    await removePhoto('photo-1', 'demo');
    await removePhoto('photo-2', 'demo');
    await savePhoto(photo('conflicting'), metadata('photo-2'));
    await expect(restorePhotos(backup, 'demo')).rejects.toThrow('different content');
    expect(await getPhoto('photo-1', 'demo')).toBeNull();
    expect(await (await getPhoto('photo-2', 'demo'))!.text()).toBe('conflicting');
  });
  it('rejects oversized uncompressed ZIP declarations before decompression', async () => {
    await savePhoto(photo(), metadata('photo-1'));
    const backup = await exportPhotos('demo');
    const bytes = new Uint8Array(await backup.arrayBuffer());
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset + 46 < bytes.length; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + 24, 300 * 1024 * 1024, true); break; }
    }
    await expect(restorePhotos(new Blob([bytes]), 'demo')).rejects.toThrow('oversized');
  });
});
