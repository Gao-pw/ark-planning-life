import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/node_modules/**', 'src-tauri/target/**', '**/target/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
