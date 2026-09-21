import { defineConfig, loadEnv } from 'vite';

const stagingApiUrl =
  'https://yvtgwzvjpztvztozcfir.supabase.co/functions/v1/ylp-api';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = process.env.GITHUB_ACTIONS ? stagingApiUrl : env.VITE_API_URL;

  return {
    base: './',
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    },
  };
});
