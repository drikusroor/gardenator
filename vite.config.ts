import { defineConfig } from 'vite';

// The GitHub Pages project site lives at https://<user>.github.io/<repo>/,
// so assets must be requested from that sub-path. The workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
