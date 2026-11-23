import { initializeApp, getApps } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, onAuthStateChanged, setPersistence, signInWithCustomToken, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, onSnapshot } from 'firebase/firestore';

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

/** Firebase identity authenticates the DEVICE. Me/Brother PINs only select a local operator. */
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
    await signOut(firebaseAuth);
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

/** Only an owner-issued short-lived custom token can enrol a device. No public registration. */
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
