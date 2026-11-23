/**
 * This is a local screen lock, not Firebase authentication or encryption.
 * A device must be enrolled separately before live agency data is accessible.
 * A person with browser-storage/devtools access can remove this protection.
 */
export type PinMode = 'demo' | 'live';
export type PinProfile = 'me' | 'brother';

interface PinRecord {
  version: 1;
  salt: string;
  hash: string;
  iterations: number;
  failedAttempts: number;
  lockedUntil: number;
}
export interface PinResult { ok: boolean; retryAfterSeconds: number }
const ITERATIONS = 310_000;
const LOCK_START = 5;
const operations = new Map<string, Promise<unknown>>();

function key(mode: PinMode, profile: PinProfile): string {
  if (!['demo', 'live'].includes(mode) || !['me', 'brother'].includes(profile)) throw new Error('Invalid profile.');
  return `si-ledger:pin:v1:${mode}:${profile}`;
}
function read(mode: PinMode, profile: PinProfile): PinRecord | null {
  const raw = localStorage.getItem(key(mode, profile));
  if (!raw) return null;
  try {
    const record: PinRecord = JSON.parse(raw);
    if (record.version !== 1 || !/^[A-Za-z0-9+/]{22}==$/.test(record.salt) || !/^[A-Za-z0-9+/]{43}=$/.test(record.hash)
      || record.iterations !== ITERATIONS || !Number.isSafeInteger(record.failedAttempts) || record.failedAttempts < 0
      || !Number.isSafeInteger(record.lockedUntil) || record.lockedUntil < 0) throw new Error();
    return record;
  } catch { throw new Error('This local PIN record is damaged. Re-enrol this device with the owner to reset it.'); }
}
function write(mode: PinMode, profile: PinProfile, record: PinRecord): void {
  localStorage.setItem(key(mode, profile), JSON.stringify(record));
}
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function unbase64(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function validPin(pin: string): void { if (!/^\d{6}$/.test(pin)) throw new Error('Use exactly six digits for your PIN.'); }
async function hash(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, 256);
  return new Uint8Array(bits);
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ (b[i] ?? 0);
  return difference === 0;
}
async function serial<T>(mode: PinMode, profile: PinProfile, action: () => Promise<T>): Promise<T> {
  const id = key(mode, profile);
  const prior = operations.get(id) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(async () => typeof navigator !== 'undefined' && navigator.locks?.request
    ? navigator.locks.request(id, action) : action());
  operations.set(id, next);
  try { return await next; } finally { if (operations.get(id) === next) operations.delete(id); }
}
async function createRecord(pin: string): Promise<PinRecord> {
  validPin(pin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await hash(pin, salt, ITERATIONS);
  return { version: 1, salt: base64(salt), hash: base64(digest), iterations: ITERATIONS, failedAttempts: 0, lockedUntil: 0 };
}
async function verifyUnlocked(mode: PinMode, profile: PinProfile, pin: string): Promise<PinResult> {
  const record = read(mode, profile);
  if (!record) return { ok: false, retryAfterSeconds: 0 };
  const remaining = Math.max(0, Math.ceil((record.lockedUntil - Date.now()) / 1000));
  if (remaining) return { ok: false, retryAfterSeconds: remaining };
  const correct = /^\d{6}$/.test(pin) && equal(await hash(pin, unbase64(record.salt), record.iterations), unbase64(record.hash));
  if (correct) {
    write(mode, profile, { ...record, failedAttempts: 0, lockedUntil: 0 });
    return { ok: true, retryAfterSeconds: 0 };
  }
  record.failedAttempts += 1;
  const seconds = record.failedAttempts >= LOCK_START ? Math.min(1800, 30 * 2 ** Math.min(6, Math.floor((record.failedAttempts - LOCK_START) / 5))) : 0;
  record.lockedUntil = seconds ? Date.now() + seconds * 1000 : 0;
  write(mode, profile, record);
  return { ok: false, retryAfterSeconds: seconds };
}
export function hasPin(mode: PinMode, profile: PinProfile): boolean { return read(mode, profile) !== null; }
export function getPinLockout(mode: PinMode, profile: PinProfile): number {
  return Math.max(0, Math.ceil(((read(mode, profile)?.lockedUntil ?? 0) - Date.now()) / 1000));
}
/** Initial profile setup only. Existing PINs require change or owner re-enrolment. */
export async function setPin(mode: PinMode, profile: PinProfile, pin: string): Promise<void> {
  return serial(mode, profile, async () => {
    if (read(mode, profile)) throw new Error('A PIN already exists. Change it using the current PIN.');
    write(mode, profile, await createRecord(pin));
  });
}
export async function verifyPin(mode: PinMode, profile: PinProfile, pin: string): Promise<PinResult> {
  return serial(mode, profile, () => verifyUnlocked(mode, profile, pin));
}
export async function changePin(mode: PinMode, profile: PinProfile, current: string, next: string): Promise<void> {
  validPin(next);
  return serial(mode, profile, async () => {
    const result = await verifyUnlocked(mode, profile, current);
    if (!result.ok) throw new Error(result.retryAfterSeconds ? `Try again in ${result.retryAfterSeconds} seconds.` : 'The current PIN is incorrect.');
    write(mode, profile, await createRecord(next));
  });
}
/**
 * Caller must first complete owner-controlled Firebase device re-enrolment.
 * This only resets a local screen lock and does not grant any server access.
 */
export async function resetPinAfterOwnerEnrollment(mode: PinMode, profile: PinProfile, next: string): Promise<void> {
  return serial(mode, profile, async () => write(mode, profile, await createRecord(next)));
}
