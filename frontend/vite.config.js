import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the UI runs on :5173 and forwards /api to the Python backend.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
