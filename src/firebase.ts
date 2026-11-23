import { initializeApp, getApps } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, onAuthStateChanged, setPersistence, signInAnonymously, signInWithCustomToken, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, increment, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';

/** These are public Firebase web configuration values, never admin credentials. */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const agencyId: string = import.meta.env.VITE_AGENCY_ID || 'saman-indika';
export const configured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
export const firebaseProjectId: string = config.projectId || 'unconfigured';
const app = configured ? (getApps()[0] || initializeApp(config)) : null;
export const firebaseAuth = app ? getAuth(app) : null;
export const firestore = app ? getFirestore(app) : null;
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === 'true' && firebaseAuth && firestore) {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
}

export interface DeviceIdentity { uid: string; agencyId: string; verifiedAt: string }
const trustedKey = `si-ledger:trusted:${firebaseProjectId}:${agencyId}`;
const getTrusted = (): DeviceIdentity | null => {
  try { return JSON.parse(localStorage.getItem(trustedKey) || 'null') as DeviceIdentity | null; } catch { return null; }
};
const trust = (uid: string): DeviceIdentity => {
  const identity = { uid, agencyId, verifiedAt: new Date().toISOString() };
  localStorage.setItem(trustedKey, JSON.stringify(identity));
  return identity;
};
const forgetTrust = () => localStorage.removeItem(trustedKey);

/** The Firebase identity authenticates the device. The local PIN unlocks the screen. */
export async function getDeviceIdentity(): Promise<DeviceIdentity | null> {
  if (!firebaseAuth || !firestore) return null;
  await firebaseAuth.authStateReady();
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  const cached = getTrusted();
  if (!navigator.onLine) return cached?.uid === user.uid ? cached : null;
  try {
    const membership = await getDocFromServer(doc(firestore, 'agencies', agencyId, 'devices', user.uid));
    if (membership.exists() && membership.data().active === true) return trust(user.uid);
    forgetTrust();
    if (membership.exists() || !user.isAnonymous) await signOut(firebaseAuth);
    return null;
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    if (/permission-denied|unauthenticated/.test(code)) {
      forgetTrust();
      await signOut(firebaseAuth);
      return null;
    }
    // A known device can continue locally during an outage. Rules check revocation on reconnect.
    if (cached?.uid === user.uid && /unavailable|deadline-exceeded|network-request-failed/.test(code)) return cached;
    throw error;
  }
}

/** Recovery path for an owner-issued custom token. */
export async function enrollDevice(token: string): Promise<DeviceIdentity> {
  if (!firebaseAuth || !firestore) throw new Error('Configure the Firebase project before enrolling a device.');
  if (!navigator.onLine) throw new Error('An internet connection is required for first-time device enrolment.');
  if (!token.trim()) throw new Error('Enter the device enrolment token issued by the owner.');
  await setPersistence(firebaseAuth, browserLocalPersistence);
  await signInWithCustomToken(firebaseAuth, token.trim());
  const identity = await getDeviceIdentity();
  if (!identity) throw new Error('This device has not been authorised for this agency. Ask the owner to enable its device record.');
  return identity;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function pinProof(windowId: string, pin: string): Promise<string> {
  if (!/^\d{6}$/.test(pin)) throw new Error('Enter your six-digit Owner PIN.');
  const input = new TextEncoder().encode(`${windowId}:${pin}`);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)));
}

export async function openOwnerPinSetup(pin: string): Promise<void> {
  if (!firestore || !navigator.onLine) throw new Error('Connect to the internet to add a phone.');
  const windowId = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await pinProof(windowId, pin);
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, 'agencies', agencyId, 'setup', 'window'), { id: windowId, openedAt: serverTimestamp() });
  batch.set(doc(firestore, 'agencies', agencyId, 'setup', 'pinState'), {
    id: windowId, digest, attempts: 0, joined: 0, lastUid: '', lastAttemptId: '',
  });
  await batch.commit();
}

export async function enrollWithOwnerPin(pin: string): Promise<void> {
  if (!firebaseAuth || !firestore || !navigator.onLine) throw new Error('Connect to the internet to set up this phone.');
  if (!/^\d{6}$/.test(pin)) throw new Error('Enter your six-digit Owner PIN.');
  await firebaseAuth.authStateReady();
  if (await getDeviceIdentity()) throw new Error('This browser is already set up. Open the live workspace and use your Owner PIN.');
  await setPersistence(firebaseAuth, browserLocalPersistence);
  const user = firebaseAuth.currentUser ?? (await signInAnonymously(firebaseAuth)).user;
  const window = await getDocFromServer(doc(firestore, 'agencies', agencyId, 'setup', 'window'));
  const windowId = window.get('id');
  if (typeof windowId !== 'string' || !/^[0-9a-f]{32}$/.test(windowId)) {
    throw new Error('On an enrolled device, open Settings → Add a phone with Owner PIN first.');
  }
  const proof = await pinProof(windowId, pin);
  const state = doc(firestore, 'agencies', agencyId, 'setup', 'pinState');
  const attemptRef = doc(firestore, 'agencies', agencyId, 'setupAttempts', user.uid);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const attempt = writeBatch(firestore);
  attempt.update(state, { id: windowId, attempts: increment(1), lastUid: user.uid, lastAttemptId: nonce });
  attempt.set(attemptRef, { windowId, nonce, proof, attemptedAt: serverTimestamp() });
  try {
    // Even an incorrect PIN must commit an attempt before any claim can be checked.
    await attempt.commit();
  } catch (error) {
    if ((error as { code?: string }).code === 'permission-denied') throw new Error('The setup window is closed. Open a new one on an enrolled device.');
    throw error;
  }
  const claim = writeBatch(firestore);
  claim.update(state, { id: windowId, joined: increment(1) });
  claim.set(doc(firestore, 'agencies', agencyId, 'devices', user.uid), {
    enrollment: 'owner-pin', label: 'Owner PIN device', active: true, createdAt: serverTimestamp(),
  });
  claim.delete(attemptRef);
  try {
    await claim.commit();
  } catch (error) {
    if ((error as { code?: string }).code === 'permission-denied') throw new Error('PIN did not match or the setup window changed. Check the PIN and try again.');
    throw error;
  }
  trust(user.uid);
}

/** Removes cloud credentials; existing local receipts and queued records remain for owner recovery. */
export async function revokeLocalSession(): Promise<void> {
  forgetTrust();
  if (firebaseAuth) await signOut(firebaseAuth);
}

export function watchDeviceIdentity(listener: (identity: DeviceIdentity | null, error?: string) => void): () => void {
  if (!firebaseAuth || !firestore) { queueMicrotask(() => listener(null)); return () => {}; }
  let stopMembership: (() => void) | undefined;
  let stopped = false;
  const stopAuth = onAuthStateChanged(firebaseAuth, user => {
    stopMembership?.(); stopMembership = undefined;
    if (!user) { listener(null); return; }
    const cached = getTrusted();
    if (cached?.uid === user.uid) listener(cached);
    stopMembership = onSnapshot(doc(firestore!, 'agencies', agencyId, 'devices', user.uid), { includeMetadataChanges: true }, snapshot => {
      if (stopped) return;
      if (snapshot.metadata.fromCache) {
        if (cached?.uid === user.uid) listener(cached);
        return;
      }
      if (snapshot.exists() && snapshot.data().active === true) listener(trust(user.uid));
      else {
        if (user.isAnonymous && !snapshot.exists()) { forgetTrust(); listener(null); return; }
        forgetTrust(); listener(null, 'This device has been revoked. Contact the owner.');
        void signOut(firebaseAuth!).catch(() => {});
      }
    }, error => {
      if (stopped) return;
      if (/permission-denied|unauthenticated/.test(error.code)) {
        forgetTrust(); listener(null, 'This device is no longer authorised.');
        void signOut(firebaseAuth!).catch(() => {});
      } else if (cached?.uid === user.uid) listener(cached, 'Working from this device while the connection is unavailable.');
      else listener(null, error.message);
    });
  });
  return () => { stopped = true; stopMembership?.(); stopAuth(); };
}

export function getDeviceId(): string {
  const key = 'si-ledger:device-id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
