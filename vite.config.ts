import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.js',
      },
    ]),
    renderer(),
  ],
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/database'
    ]
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'chart.js', 'react-chartjs-2'],
          firebase: ['firebase/app', 'firebase/database'],
          ui: ['lucide-react']
        }
      }
    },
    target: 'esnext',
    minify: 'esbuild',
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    }
  }
});