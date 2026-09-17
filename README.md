# YLP Attendance — Frontend

Static frontend for the existing Google Apps Script attendance API. Backend code, Google Sheets records, and credentials are not included.

## Local development

Run `npm ci`, then set `VITE_API_URL` in an ignored `.env.local` file to your deployed Apps Script URL ending in /exec. Run `npm run dev`.

## Production build

Run `npm run build`. Output is in ignored `dist/`. Vite configuration values are public in the built app; never put passwords or tokens in them.

## GitHub Pages

The workflow reads `vars.VITE_API_URL`, already configured in repository Actions variables. It deploys only when manually started using Actions → Deploy static app to GitHub Pages → Run workflow. Pushing code does not trigger deployment. Set Pages source to GitHub Actions before the first authorized deployment.

Application validation is maintained in the separate development workspace; test fixtures and backend files are excluded from this frontend-only repository.


## Local scan reconciliation contract

This frontend requires `scan_request_idempotency: true` in the session response. It preserves each pending scan UUID, identity, and direction in same-tab session storage and offers an explicit same-ID confirmation retry after an uncertain result. QR tokens and admin credentials are not stored. The matching local Apps Script update requires an appended `scan_receipts` Attendance column, populated alongside attendance in one row write. See the main project's README for the backend migration and test details. These local changes have not been deployed; do not publish this frontend alone against the older backend. Repository name and public URL remain unchanged.


## Reliability pass (local, not deployed)

Pending scan/session confirmations survive navigation and reload, preserve their UUID and scan direction, and are never automatically resubmitted. Camera lifecycle cleanup handles delayed startup. API deadlines use AbortController and cover response bodies. Only a session-read redirected 404 permits one retry at the configured /exec URL.

All displayed class/attendance times and date filters use Asia/Bangkok. Creation inputs are converted to the existing backend offset; original stored UTC timestamps are unchanged. Reports reuse assembled rows during filtering. Narrow-phone confirmation buttons wrap without overflow.

The matched backend release must include both reviewed Code.gs and Core.gs and the trailing Attendance scan_receipts column. Keep attendance paused through the coordinated migration/release. Do not publish this frontend alone. Authentication, internal identifiers, API URL, repository name and public URL are unchanged.

The relative Vite base supports a future repository path such as ylp-attendance, but no rename/configuration change is made here. That move would require explicit authorization and newly generated links/QRs at the new path. Existing QR URLs embed the current path.
