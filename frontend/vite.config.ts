import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `vite build --mode artifact` produces one self-contained HTML file for claude.ai
// (agents run in the browser, see src/backend/artifact.ts). Every other mode builds the
// server frontend that talks to the FastAPI backend.
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact'
  return {
    plugins: [react(), tailwindcss(), ...(artifact ? [viteSingleFile()] : [])],
    define: { 'import.meta.env.VITE_TARGET': JSON.stringify(artifact ? 'artifact' : 'server') },
    build: artifact ? { outDir: 'dist-artifact', chunkSizeWarningLimit: 4000 } : undefined,
    server: {
      proxy: { '/api': 'http://localhost:8000' },
    },
  }
})
