import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Proxy /api to the FastAPI backend on :8000 so the frontend can use same-origin paths.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
