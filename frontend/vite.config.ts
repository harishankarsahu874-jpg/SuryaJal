import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The FastAPI backend (uvicorn on :8000) serves the built site from ../static/site.
// During `npm run dev`, API + tool requests are proxied to it.
const BACKEND = process.env.SURYAJAL_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': BACKEND,
      '/r': BACKEND,
      '/app': BACKEND,
      '/static': BACKEND,
    },
  },
  build: {
    outDir: '../static/site',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
})
