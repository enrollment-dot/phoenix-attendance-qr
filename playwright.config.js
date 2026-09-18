import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'browser.spec.js',
  use: {
    baseURL: 'http://127.0.0.1:5184',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run dev -- --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    env: { VITE_API_URL: 'http://127.0.0.1:5184/__test_api' },
    reuseExistingServer: false,
  },
  reporter: 'list',
});
