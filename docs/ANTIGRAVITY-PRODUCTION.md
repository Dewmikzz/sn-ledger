# SI Ledger production handoff

## Test wireless thermal printing

Open **Reports → Thermal report** and select the roll width from the packaging or measure the paper. Start with the 80 mm layout only if the installed roll is 80 mm. The other option is 58 mm.

1. Pair the QR 380A-A424 / B80B printer in your phone’s Bluetooth settings if the printer instructions call for system pairing. Enable the vendor’s compatible Android print service if available. On desktop, install the vendor’s Bluetooth or USB printer driver.
2. Tap **Print thermal report** and select the printer and matching paper size. Disable headers and footers if available. Check the preview and print one test.
3. If pairing works but the printer does not appear, check the vendor’s Android print service or companion app. You can try saving to PDF and importing into the companion app if it supports PDF printing. For a desktop fallback, connect via USB and use the vendor driver.
4. Check legibility, right-edge clipping, blank feed and report totals on a real roll. Record exact model, phone OS, driver/service and successful settings. Keep standard **Print report** available.

This PWA uses the browser/OS print dialog. Compatibility with this physical printer, direct Bluetooth and vendor protocol support are unverified. Many portable printers require a vendor app. System pairing alone does not guarantee the printer appears in Android, iOS, or desktop print dialogs.

## Paste this into Antigravity

Extract the source ZIP and open its folder as the workspace. Open a new Antigravity task and paste the following.

> Prepare this existing React/Vite/Firebase SI Ledger PWA for production. Retain its cream and forest theme, demo/live isolation, ledger calculations, PIN workflow, offline queue and photo backups. Work in the extracted repository. Start by reading README.md, docs/SETUP.md, docs/VERIFICATION.md and docs/ANTIGRAVITY-PRODUCTION.md. Run npm ci, npm test, npm run test:rules and npm run build. Fix reproducible failures and document checks that you could not run.
>
> Configure a staging deployment using the owner’s Firebase Spark project or an owner-approved isolated project. Follow the setup guide for client environment variables, Firestore rules and indexes, and Firebase Hosting. Keep service-account credentials outside the repository, ZIP and browser bundle. Have the owner enrol two devices using the admin script. Ask for the intended production project or explicit approval only when it is required to change the owner’s cloud resources or deploy live. Never enable billing or broaden agency access without permission.
>
> Verify the original Rs. 25,000 invoice and cheque scenarios, concurrent offline collections, revocation, receipt backup and restore, reconciliation corrections and original closes. Test 360, 390, 768, 1024 and 1366 px layouts. Test offline reopening of the installed PWA. In Sales Analytics, confirm that Rs. 25,000 in invoice sales yields Rs. 1,750 estimated gross profit and old balance collections change only collected cash. Confirm filters and revised totals.
>
> With my QR 380A-A424 / B80B portable thermal printer, verify Android Bluetooth printing first and desktop USB as a fallback. Confirm the actual paper size and print service or driver using the vendor instructions and a test print. If the system cannot expose the printer, validate a compatible vendor print app or service before proposing a model-specific integration. Only implement direct Bluetooth if exact transport and protocol are documented and the target operating system supports them. Validate both standard and thermal reports, totals, warnings and paper clipping.
>
> Deliver the final test record, production configuration instructions, rollback steps and a clean ZIP excluding secrets, customer data, node_modules and Git history. Before deploying production, present the targeted Firebase project and validated staging configuration. Leave any real-device check pending unless it was actually performed.
