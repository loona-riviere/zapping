import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE est défini par le workflow GitHub Pages (/nom-du-repo/)
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
})
