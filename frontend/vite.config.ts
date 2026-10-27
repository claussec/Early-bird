import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Three builds from one code base (see src/backend/index.ts):
//   default            → server frontend that talks to the FastAPI backend
//   --mode artifact    → one self-contained HTML file for claude.ai (agents run in the browser)
//   --mode demo        → one self-contained HTML file to host anywhere (demo data, rule-based)
export default defineConfig(({ mode }) => {
  const target = mode === 'artifact' || mode === 'demo' ? mode : 'server'
  const single = target !== 'server'
  return {
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
    define: { 'import.meta.env.VITE_TARGET': JSON.stringify(target) },
    build: single ? { outDir: `dist-${target}`, chunkSizeWarningLimit: 6000 } : undefined,
    server: {
      proxy: { '/api': 'http://localhost:8000' },
    },
  }
})
