# Saman Indika Ledger

**Daily collections, credit & cheques**

A phone-first, installable collections ledger for **Saman Indika**, Lakmee distribution agency, **Polonnaruwa, Sri Lanka**. The home-screen name is **SI Ledger**. Developed by **Dewmika Anusara** · [dew.pshycolab.com](https://dew.pshycolab.com).

The app records what happens after a Lakmee invoice: receipt photos, cash, credit, cheques, later collections, and daily cash reconciliation. It does not create invoices or manage products, inventory, or customer accounts.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

The explicitly labelled **demo mode** uses sample records and an isolated local database. It does not connect sample records to a live agency. Live mode requires your Firebase project and an owner-enrolled device. There are no shipped PINs or privileged credentials.

```sh
npm test
npm run test:rules
npm run build
npm run preview
```

The Firestore Rules tests require Java 21+ and download the Firebase emulator on their first run. The production build includes the PWA manifest, real icons, and an offline app shell; offline behaviour should be checked using a production build or HTTPS deployment rather than relying on Vite development mode.

## Included

- React, TypeScript, Vite, Firestore, and classic Firebase Hosting configuration.
- Separate “Record invoice” and “Collect old balance” workflows; integer minor-unit accounting in LKR.
- Shop ledgers, linked cheque allocations, received/deposited/cleared/returned transitions, and auditable corrections.
- Daily totals, cash counts and differences, preserved close-of-day snapshots, print view, and CSV export.
- Two local operator profiles, six-digit PINs, lock/profile switching, and owner-issued Firebase device enrolment.
- Durable local work queue, idempotent event IDs, cross-device event sync, and preserved excess-collection conflicts.
- Original receipt photos stored on the capturing device, with ZIP export and restore. Ledger sync does **not** upload these photos.
- Firebase Security Rules and indexes, an owner-only administration script, and a Vercel configuration.

## Deploy and operate

Read [the complete setup guide](docs/SETUP.md) for Firebase Spark setup, enrolment, adding your brother’s phone, installing the app, revocation, PIN reset, and photo backups. [Verification](docs/VERIFICATION.md) records which checks ran and which still require your project or a real phone.

No Firebase project credentials were supplied for this build. A published demo is a working demonstration; it is not evidence that your agency’s Firebase access, device enrolment, or cross-device production sync has been activated.

## Source map

| File | Purpose |
| --- | --- |
| `src/domain.ts` | Money, immutable events, ledger projection, and report calculations |
| `src/store.ts` | Durable local queue and ledger state |
| `src/firebase.ts` | Firebase configuration, device identity, and synchronization |
| `src/photos.ts` | Original local images and ZIP backup/restore |
| `src/pin.ts` | Salted local PIN verification and retry throttling |
| `firestore.rules` | Agency membership, device access, and write constraints |
| `scripts/admin.mjs` | Owner-run agency initialization, device enrolment, and revocation |
| `firebase.json` / `vercel.json` | Deployment configurations |

Keep service-account credentials outside this repository. The browser’s `VITE_FIREBASE_*` values identify a Firebase project; access control comes from Authentication and the deployed Firestore Rules.
