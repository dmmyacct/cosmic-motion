import { defineConfig } from 'vite';
import path from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';

const useHttps = process.env.HTTPS === 'true';

export default defineConfig({
  plugins: useHttps ? [basicSsl()] : [],
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@sensors': path.resolve(__dirname, 'src/sensors'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  server: {
    host: true,
    ...(useHttps ? { https: {} } : {}),
  },
});
