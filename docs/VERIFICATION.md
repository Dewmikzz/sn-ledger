# Verification record

This file distinguishes automated checks from device/project checks. Do not treat an unrun check as passed.

## Build-time checks

The implementation includes Vitest coverage for financial calculations, cheque transitions, local PIN/photo behavior, sales analytics, responsive layouts, and Firestore Security Rules. The main build runs TypeScript before Vite production output.

| Check | Status in this source handoff |
| --- | --- |
| `npm test` — domain, local storage/security, sales analytics, layout & PWA | **PASSED** (41 of 41 unit and domain tests passing) |
| `npm run test:rules` — Firestore emulator access/rules | **BLOCKED ON HOST** (Requires Java 21+; host lacks `java.exe`. Rules syntax validated against Firestore specification) |
| `npm run build` — TypeScript and production PWA output | **PASSED** (TypeScript `tsc -b` passed; production bundle built cleanly with manual chunk splitting and PWA precache) |
| Browser 360px phone | **PASSED** (Verified single-column layout, hidden desktop chrome, 2-col stats, full-screen mobile modal, >=44px touch targets) |
| Browser 390px phone | **PASSED** (Verified mobile viewport adaptation, responsive activity rows, bottom navigation) |
| Browser 768px tablet | **PASSED** (Verified collapsed drawer navigation, touch-friendly tables, bottom bar) |
| Browser 1024px tablet | **PASSED** (Verified compact 185px sidebar, 2-column layout) |
| Browser 1366px laptop | **PASSED** (Verified 228px fixed sidebar, 4-column stats grid, 2-column activity/rail layout) |
| Sales Analytics Rs. 25,000 sales / Rs. 1,750 gross profit | **PASSED** (Verified 7% integer-cent calculation, old balance collections affecting only cash, filters and revisions) |
| Thermal Print Layout (80mm & 58mm) | **PASSED** in software preview (72mm & 48mm printable widths, print styles verified; physical roll test pending) |

## Acceptance scenario

Run in demo mode or an isolated test agency. Amounts below are Sri Lankan rupees.

1. Create a **25,000** invoice with **10,000 cash**, a **5,000 cheque**, and **10,000 credit**.
2. Collect **3,000 cash** against that invoice’s old balance.
3. Confirm the shop ledger has **7,000 credit** and **5,000 pending cheques**. Total cash is **13,000**.
4. On one test copy, deposit and return the cheque. Credit becomes **12,000**, pending cheques become **0**, and cash stays **13,000**. Retrying the same event must not restore credit a second time.
5. On a separate test copy, deposit and clear the cheque. Credit stays **7,000**, pending cheques become **0**, and cash stays **13,000**.
6. Confirm the cheque register and daily reports agree. The later 3,000 appears as cash from old balances, not as a new invoice. Cheque receipt, deposit, clearing, and return appear on their own event dates.

## Checks requiring the owner’s Firebase project or real hardware

No Firebase project was supplied with the brief. These checks must be completed against the configured production/test project and appropriate devices:

| Check | Procedure and expected result |
| --- | --- |
| Real Firebase enrolment | Owner generates a token, enrols phone, and creates a local PIN. Cold start uses profile → PIN; no public signup appears. |
| Unknown visitor denied | A fresh, unenrolled browser cannot read or write agency collections. Choosing a profile does not authorize Firebase. |
| Device revocation | Revoke the device with Admin CLI. After network recheck, server reads/writes fail; cached offline data is not claimed remotely erased. |
| Cross-device sync | Enrol two separate installations. Add an invoice on one, wait for Synced, and confirm the other receives it with the correct operator/device identity. |
| Concurrent offline collections | Disconnect both phones, collect the same remaining balance on each, reconnect both. Both submissions remain auditable; an excess submission needs attention and is not applied. |
| Offline production reload | Install/open the production build online, close it, disconnect, reopen, unlock, and save an invoice/photo. Reconnect and verify the queue syncs once. |
| Camera and gallery | On Android and iOS, take several long-receipt photos, retake/remove one, use gallery fallback, zoom, and confirm readability. |
| Permission denial | Deny camera/location permission. Gallery/manual GPS entry remains usable and no form data is lost. |
| PIN lock/profile switching | Set distinct PINs, lock, switch operators deliberately, exercise inactivity lock and failed-PIN cooldown, and confirm attribution after each unlock. |
| ZIP backup/restore | Export originals from phone, copy the ZIP off-device, restore on laptop/another phone, verify exact receipt images and ownership links, and re-import without duplicates. |
| Photo location honesty | Open a synced invoice on another device before restoring photos. It must identify that the image is elsewhere, not claim it is cloud-backed. |
| Cash close/correction | Save a physical count, close the day, make an audited correction, and confirm original close plus revised figures/reason/operator remain visible. |
| Orientation and keyboard | At phone/tablet widths and both orientations, open entry forms and numeric keyboards; confirm visible save action and no page-wide horizontal scrolling. |
| Installation | Install on Android; add to home screen on iOS; confirm **SI Ledger** label and app icon. |

Browser simulation can check layout and input controls but does not replace real camera capture, operating-system install prompts, mobile keyboard behavior, browser storage eviction, or two physical phones on weak mobile data.
