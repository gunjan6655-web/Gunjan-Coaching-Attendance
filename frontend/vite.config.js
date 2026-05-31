import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: 'localhost'
  },
  build: {
    // Split big libraries into their own files so the browser can cache them
    // and the main app code loads faster on first visit.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'icons': ['lucide-react'],
        }
      }
    },
    chunkSizeWarningLimit: 900
  }
})
