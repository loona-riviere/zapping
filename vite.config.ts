import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE ne sert qu'à un hébergement sous sous-chemin ; Netlify sert à la racine.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
})
