# Phoenix Attendance QR — Frontend

Static frontend for the existing Google Apps Script attendance API. Backend code, Google Sheets records, and credentials are not included.

## Local development

Run `npm ci`, then set `VITE_API_URL` in an ignored `.env.local` file to your deployed Apps Script URL ending in /exec. Run `npm run dev`.

## Production build

Run `npm run build`. Output is in ignored `dist/`. Vite configuration values are public in the built app; never put passwords or tokens in them.

## GitHub Pages

The workflow reads `vars.VITE_API_URL`, already configured in repository Actions variables. It deploys only when manually started using Actions → Deploy static app to GitHub Pages → Run workflow. Pushing code does not trigger deployment. Set Pages source to GitHub Actions before the first authorized deployment.

Application validation is maintained in the separate development workspace; test fixtures and backend files are excluded from this frontend-only repository.
