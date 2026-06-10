import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['tormod.diaslabs.com.br'],
    proxy: {
      '/api': {
        target: process.env.TORMOD_API ?? 'http://127.0.0.1:8790',
        changeOrigin: true,
      },
    },
  },
})
