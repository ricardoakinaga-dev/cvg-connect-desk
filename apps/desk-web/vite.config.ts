import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isDocker = process.env.DOCKER === 'true';
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET
  || process.env.VITE_API_URL
  || (isDocker ? 'http://desk-api:3000' : 'http://localhost:3000');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true, // Permite acesso via Cloudflare tunnel e qualquer host
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
