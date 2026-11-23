#!/usr/bin/env node
/**
 * Owner-only administration. Run on a trusted computer, never in a browser.
 * Uses Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS).
 * This program must never be bundled or uploaded to Firebase Hosting.
 */
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agency: { type: 'string' }, name: { type: 'string' },
    label: { type: 'string' }, uid: { type: 'string' },
    project: { type: 'string' }, help: { type: 'boolean' },
  },
});
const usage = `Saman Indika Ledger — owner device administration

Usage (requires Google Application Default Credentials):
  node scripts/admin.mjs init --project PROJECT_ID --agency AGENCY_ID --name "Saman Indika Ledger"
  node scripts/admin.mjs enroll --project PROJECT_ID --agency AGENCY_ID --label "Saman's phone"
  node scripts/admin.mjs revoke --project PROJECT_ID --agency AGENCY_ID --uid DEVICE_UID
  node scripts/admin.mjs devices --project PROJECT_ID --agency AGENCY_ID

Enrollment prints a bearer custom token that expires in about one hour. Keep it
private, paste it directly into the trusted phone's owner setup screen, and close
the terminal afterwards. It is an identity credential, never a daily PIN.

PIN reset: export local photo/ledger backups first. Revoke this device, remove the
app's local PIN/device settings using the browser's site-data controls, then enroll
it with a new device identity and set new local PINs. Clearing site data also
removes local photos and unsynced records; never do so before backup and sync.
`;
if (values.help || !positionals[0]) { console.log(usage); process.exit(0); }
const command = positionals[0];
if (!['init', 'enroll', 'revoke', 'devices'].includes(command)) throw new Error('Unknown command. Use --help.');
if (!values.agency || !/^[A-Za-z0-9_-]{1,80}$/.test(values.agency)) throw new Error('Provide --agency using 1–80 letters, digits, underscores, or hyphens.');
if (!values.project) throw new Error('Provide --project with the Firebase project ID.');
initializeApp({ credential: applicationDefault(), projectId: values.project });
const db = getFirestore();
const auth = getAuth();
const agency = db.doc(`agencies/${values.agency}`);

try {
  if (command === 'init') {
    const name = (values.name || 'Saman Indika Ledger').trim();
    if (!name || name.length > 120) throw new Error('Agency name must be 1–120 characters.');
    await db.runTransaction(async tx => {
      const current = await tx.get(agency);
      if (current.exists) throw new Error('Agency already exists. init never overwrites existing data.');
      tx.create(agency, { name, timezone: 'Asia/Colombo', currency: 'LKR', createdAt: FieldValue.serverTimestamp() });
      tx.create(agency.collection('sync').doc('head'), { sequence: 0, lastEventId: '' });
    });
    console.log(`Created agency ${values.agency}. Use enroll for each trusted device.`);
  }
  if (command === 'enroll') {
    if (!(await agency.get()).exists) throw new Error('Agency does not exist. Run init first.');
    const label = (values.label || '').trim();
    if (!label || label.length > 120) throw new Error('Provide --label with 1–120 characters identifying the physical device.');
    const uid = `si-device-${randomUUID()}`;
    await auth.createUser({ uid, displayName: label });
    try {
      await agency.collection('devices').doc(uid).create({
        active: true, label, createdAt: FieldValue.serverTimestamp(),
      });
      const token = await auth.createCustomToken(uid, { agencyId: values.agency });
      console.log(`Device UID: ${uid}\nAgency: ${values.agency}\nLabel: ${label}\n\nPrivate enrolment token (expires in about 1 hour):\n${token}\n`);
      console.log('Paste this token into Owner setup on that device. Do not share it in source code, email, or screenshots.');
    } catch (error) {
      await agency.collection('devices').doc(uid).delete().catch(() => {});
      await auth.deleteUser(uid).catch(() => {});
      throw error;
    }
  }
  if (command === 'revoke') {
    if (!values.uid || values.uid.includes('/')) throw new Error('Provide --uid for the device being revoked.');
    const device = agency.collection('devices').doc(values.uid);
    if (!(await device.get()).exists) throw new Error('Device is not enrolled in this agency.');
    // Membership check blocks new server reads/writes immediately, even with a cached ID token.
    await device.update({ active: false, revokedAt: FieldValue.serverTimestamp() });
    await auth.revokeRefreshTokens(values.uid);
    await auth.updateUser(values.uid, { disabled: true });
    console.log(`Revoked ${values.uid}. Previously downloaded offline data cannot be remotely erased; recover or erase the physical device.`);
  }
  if (command === 'devices') {
    const devices = await agency.collection('devices').get();
    for (const item of devices.docs) {
      const value = item.data();
      console.log(`${item.id}\t${value.active ? 'active' : 'revoked'}\t${value.label}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Administration failed.');
  process.exitCode = 1;
}
