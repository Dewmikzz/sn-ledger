# Setup and operations

Saman Indika Ledger · Daily collections, credit & cheques  
Owner: Saman Indika · Polonnaruwa, Sri Lanka  
Developed by Dewmika Anusara · <https://dew.pshycolab.com>

## 1. Create the Firebase starter project

Use a Firebase project you control. Keep it on the **Spark plan** and use **Cloud Firestore Standard edition** in native mode, Firebase Authentication custom-token sign-in, and classic Firebase Hosting. No Cloud Functions, Cloud Storage, or paid photo-storage service is required by this starter.

1. In the Firebase Console, create or select your project.
2. Create a **Standard** Firestore database in production mode. Choose a location suitable for Sri Lanka before creating it; the database location cannot later be changed in place.
3. Initialize Firebase Authentication. Daily sign-in uses custom tokens from the owner’s administration script. Do not enable public account registration for this app. There is no need to enable email/password, phone, social, or anonymous sign-in providers.
4. Register a Web app in Project settings and copy its public Firebase configuration.
5. Review Spark usage limits in the Console. The starter listens to the agency’s complete event history; reads increase as the ledger grows. Watch read counts and storage usage and plan an archive/pagination improvement before reaching the plan’s limits.

There is no cloud photo upload. Original photos use browser IndexedDB on the device that captured them and do not consume Firebase Storage. Firestore stores ledger records and photo identifiers, not image bytes.

## 2. Configure and build

Install Node.js 22+ and run from the source directory:

```sh
npm ci
cp .env.example .env.local
```

Set these values in `.env.local`:

| Variable | Value |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Web app `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Web app `authDomain`, usually `PROJECT_ID.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Your Firebase project ID |
| `VITE_FIREBASE_APP_ID` | Web app `appId` |
| `VITE_AGENCY_ID` | Stable agency ID, for example `saman-indika` |

Use the same agency ID in your build and all administrator commands. Firebase Web configuration is public project identification. **Never** place an Admin service-account key, device custom token, or PIN in a `VITE_` variable: Vite embeds these values in the browser bundle. `.env.local` is ignored by Git.

```sh
npm test
npm run test:rules
npm run build
```

Rules tests use an isolated `demo-si-ledger` emulator project. They require Java 21+ and a first-run emulator download. They do not test your deployed project automatically.

## 3. Publish rules and hosting

Authenticate the Firebase CLI as the owner:

```sh
npx firebase login
npx firebase deploy --project YOUR_PROJECT_ID --only firestore:rules,firestore:indexes
```

Review that deployment output identifies your intended project. The repository includes deny-by-default rules; do not replace them with test-mode or public-read/public-write rules.

Deploy the already-built static app:

```sh
npx firebase deploy --project YOUR_PROJECT_ID --only hosting
```

`firebase.json` publishes `dist`, routes the app to `index.html`, and prevents stale service-worker caching. This is **classic Firebase Hosting**, not App Hosting. Add the final hosting/custom-domain hostname to Authentication’s authorized domains when required by your Firebase project configuration.

## 4. Initialize the agency and enrol the first device

Run administration only on an owner-controlled computer. The script uses Firebase Admin SDK credentials through Application Default Credentials. It does not run in the browser or require a paid server.

For a service-account key, save it in a private location **outside the project**, then set its absolute path in the current shell:

```sh
export GOOGLE_APPLICATION_CREDENTIALS=/private/path/firebase-admin-key.json
```

Keep this key out of Git, deployment archives, screenshots, chat messages, and browser storage. Use an administrator identity authorized to manage this project’s Auth users and Firestore database. Remove or rotate unused keys through Google Cloud IAM.

Initialize once:

```sh
node scripts/admin.mjs init --project YOUR_PROJECT_ID --agency saman-indika --name "Saman Indika Ledger"
```

Create an identity for the owner’s phone:

```sh
node scripts/admin.mjs enroll --project YOUR_PROJECT_ID --agency saman-indika --label "Saman's phone"
```

The command creates an authorized device UID and prints a short-lived custom sign-in token, normally valid for about one hour. Treat the token as a temporary secret: use it on the intended device and do not place it in source code, public URLs, or documentation. It is a bearer token during its validity window, not a PIN.

On the phone:

1. Open the HTTPS app, choose live agency setup, and paste the token in device enrolment.
2. The app signs in to the authorized Firebase identity and checks its active membership under the configured agency.
3. Set the local six-digit PIN for the relevant operator profile. The normal daily flow is now profile selection → PIN → Today.
4. Make one test entry, wait for its ledger sync to finish, and check it from a second enrolled device before using the app for live collections.

An unknown visitor cannot create an agency membership by selecting “Me” or “Brother”. Device memberships are written by the owner’s Admin script. Demo mode stays separate from the live agency.

## 5. Add another phone with the Owner PIN

1. Unlock an enrolled device and open **Settings → Add a phone with Owner PIN**.
2. Enter that device's Owner PIN to open a 10-minute setup window.
3. On the new phone, open the ledger, select **Set up your agency**, and enter the same PIN.

The window closes when one phone joins, after five attempts, or when it expires. The new browser uses the same PIN for its local lock and gets its own revocable Firebase device identity. Firebase Anonymous Authentication must be enabled, with automatic deletion of anonymous accounts disabled. The Firestore rules grant ledger access only after a browser completes enrolment. The Owner PIN remains local for daily unlocks. Changing it on one enrolled device does not update the PIN on another.

### Recovery token

If none of the enrolled devices are available, the Firebase administrator can issue a recovery token. The recovery option is available on the device setup screen.

Run `enroll` again with a distinct device label, for example:

```sh
node scripts/admin.mjs enroll --project YOUR_PROJECT_ID --agency saman-indika --label "Brother's phone"
```

Enrol that phone with the returned token and configure its local PINs. Repeat for the laptop if needed. Each browser installation has its own authorized Firebase UID; use a distinct enrolment for each installation. Private/incognito browsing is unsuitable for a durable ledger because closing it may remove its storage.

**Operator and authenticated identity are different.** “Me” or “Brother” is the selected human operator recorded on each entry. The Firebase UID identifies the enrolled browser/device. Switching profiles does not sign in as a different Firebase account. On a shared phone, both operators use the same device identity and separate local PIN profiles.

Display names and the agency label can be edited in Settings. Do not treat a display-name change as a new authentication identity.

## 6. Install SI Ledger

### Android

Open the HTTPS deployment in Chrome, wait for the page to load, then use **Install app** when available or Chrome’s menu → **Add to Home screen**. The installed home-screen label is **SI Ledger**. Open it once online after installation to cache the app shell and complete setup.

### iPhone/iPad

Open the HTTPS deployment in Safari, tap Share → **Add to Home Screen**, and confirm. iOS does not expose the same automatic installation prompt as Chrome. Open the installed app once online. Browser storage policies and low device storage can remove cached data, so retain photo backups.

### Laptop

In a compatible Chromium browser, use the install icon in the address bar or browser menu. The ordinary browser version also works.

Installation requires a secure origin (HTTPS, or localhost for development), a manifest, and a service worker. Offline caching applies to the production build; Vite development mode is not the production offline acceptance environment.

## 7. Daily collections and cash close

1. Select your profile and unlock with your PIN.
2. Use **Record invoice** for a new Lakmee invoice. Add the invoice reference, LKR total, cash, cheques, receipt photos, and a due date if credit remains.
3. Use **Collect old balance** for later payments. Select outstanding invoices and allocate the payment. This does not create new invoice value.
4. Move cheques through Received → Deposited → Cleared or Returned. A cleared cheque removes its pending amount without adding cash or another collection. A returned cheque restores its linked credit exactly once.
5. In Reports, choose the business date and route/operator filters. Compare expected cash with the physical cash count. Save the close, then print or download CSV as needed.

Money is calculated in integer minor units: Rs. 1.00 is stored as 100. Business dates use **Asia/Colombo**. Preserve the device’s clock accuracy when working offline; the app cannot independently verify the real collection time without a connection.

Saved close-of-day figures are retained. An audited correction records its reason, time, and operator and can change the revised report without rewriting the original close. Invoice total/original-cash corrections are supported; changing a cheque requires its appropriate recorded lifecycle and a new collection when applicable.

The report warns when this device is offline or has pending work. Even when it is fully synced, another phone can still hold entries that have not reached Firebase. Ask both operators to sync before relying on a final agency-wide close.

## 8. Offline work, conflicts, and sync

Open and enrol a trusted device online before relying on offline use. After the app shell is cached, it can reopen offline, accept PIN unlock, and record entries and photos locally.

Entries receive stable IDs before saving and enter a durable IndexedDB queue. Reconnection retries them idempotently. The app distinguishes local saves, syncing, synced records, and records needing attention. A local save is not confirmation that another device can see it.

The live event log uses a canonical server sequence. If two offline devices collect against the same remaining credit and their combined payments exceed it, both submissions are retained; the excess submission is flagged for review and excluded from applied balances. Review the actual money received, identify the correct allocation, and enter the appropriate resolution. Do not count an attention item as settled merely because it has synced.

Keep the tab open after reconnecting so pending work can finish. Browser background execution is not guaranteed. Do not clear site data or remove the app while it has unexported photos or pending records.

## 9. Photo backup and restore

Photos and ledger records have separate availability:

- **On this device** means the original image is in this browser’s IndexedDB.
- A photo identifier on another device does not mean that device has the image.
- **Backed up** means a ZIP export was prepared; it does not prove the file was safely copied to another drive.
- No photo in the starter is labelled or treated as cloud-backed.

Use Settings’ photo backup action to export a ZIP containing the original image files and a versioned manifest. The manifest links every photo to its shop, invoice, or cheque and capturing device. Copy the ZIP off the phone, ideally to an encrypted backup location. A ZIP is not encrypted by the app and can contain private shop information.

To make photos available on another enrolled device, choose photo restore there and select the ZIP. Restore checks manifest/version and image entries, preserves identifiers and links, and skips already-present photos. Keep demo and live backups separate. Restore does not create or alter financial entries; those arrive through ledger sync.

Test an export by restoring it to another device and opening a receipt before deleting an original. Repeat backups after each collection day. Do not assume uninstalling/reinstalling or switching browser origins retains IndexedDB images.

## 10. Lock, PIN changes, and lost devices

Use manual lock when handing over the phone, and use deliberate profile switching before the other person enters records. Inactivity locking provides an additional local screen lock.

PINs are salted PBKDF2 hashes with local attempt throttling. There is no working default PIN in source code. PINs are local to each device and do not replace Firebase authorization or encrypt the entire ledger/photo database. Someone with control of an unlocked browser or its developer tools may bypass the local screen lock or alter local data. Use the phone’s operating-system lock and keep trusted-device access limited to the two operators.

List enrolled devices:

```sh
node scripts/admin.mjs devices --project YOUR_PROJECT_ID --agency saman-indika
```

Revoke a lost device:

```sh
node scripts/admin.mjs revoke --project YOUR_PROJECT_ID --agency saman-indika --uid DEVICE_UID
```

Revocation deactivates agency membership, disables its Auth user, and revokes refresh tokens. Security Rules reject subsequent remote access. An offline device cannot learn about revocation until it reconnects, and revocation cannot remotely erase already cached records or photos. Use the operating system’s lost-device controls if available.

For a forgotten PIN, first synchronize pending records and export/verify local photo backups if the device can still be accessed by the other authorized profile. Revoke the old installation’s Firebase identity, clear its site data only after preserving local work, and enrol it again with a new owner-issued identity. Clearing site data removes local PINs **and** cached data, pending queues, and local photos. Restore photos from the saved ZIP afterward. If you cannot unlock or export the only copy, do not wipe it expecting Firebase to restore local-only photos.

## 11. Vercel deployment

The supplied `vercel.json` builds with `npm run build`, serves `dist`, and routes app pages to `index.html`. Import this repository into your Vercel project, select a plan suitable for your agency use, and add the same `VITE_FIREBASE_*` and `VITE_AGENCY_ID` environment variables. Redeploy when build-time environment values change.

Keep the same Firebase project/rules and enrol each browser installation using the new origin. Browser storage is scoped to the origin: photos and local queues on the Firebase Hosting domain do not automatically transfer to the Vercel domain. Sync pending entries and export photos before changing origins; restore the ZIP on the new origin.

Do not deploy the administrator credentials or `.env.local`. The admin script is an owner-side tool, not a server route.

## 12. Scope and ongoing checks

Before collecting live money, complete the real-device/project checks in [VERIFICATION.md](VERIFICATION.md). Confirm access denial for an unenrolled browser, multi-device updates and concurrent offline collections, local photo backup/restore, and production offline reload. The emulator exercises rule behavior but does not configure your real project.

For a later cloud-photo upgrade, choose private storage with agency/device access rules and explicit uploaded/available/backup states. Keep local-photo wording accurate until the original files have actually uploaded. That upgrade is deliberately outside this Spark starter.
