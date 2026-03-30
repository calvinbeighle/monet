/**
 * vite.config.ts
 * Vite configuration for the Monet frontend.
 * Uses @tailwindcss/vite plugin for Tailwind v4 integration.
 * Configures @/ path alias pointing to ./src/.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    /**
     * Split Three.js and React Three Fiber into a separate vendor chunk
     * so the main app bundle stays lean and Three.js loads lazily.
     * Uses a function form for manualChunks to satisfy the Rolldown type.
     */
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes('three') ||
            id.includes('@react-three/fiber') ||
            id.includes('@react-three/drei')
          ) {
            return 'three-vendor';
          }
          return undefined;
        },
      },
    },
  },
})
