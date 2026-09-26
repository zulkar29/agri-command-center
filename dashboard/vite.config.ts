import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Local Go API (`go run ./cmd/server` in backend/), so `npm run dev`
      // works with the default empty VITE_API_URL — same-origin /api is
      // proxied exactly like the Go server serves it in production.
      '/api': 'http://localhost:8000',
    },
  },
})
