/**
 * vite.config.ts
 * Vite configuration for the Monet frontend.
 * Uses @tailwindcss/vite plugin for Tailwind v4 integration.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
})
