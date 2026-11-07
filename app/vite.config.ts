import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// Vite config for the Bulldogs OS SPA (decision D2).
// tanstackRouter generates src/routeTree.gen.ts from src/routes at dev/build time.
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: false }), react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
