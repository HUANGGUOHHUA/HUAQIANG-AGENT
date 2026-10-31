import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // The agent worker runs outside the asar (in resources/) as a headless
    // Electron process, so its MCP dependency must be bundled.
    plugins: [externalizeDepsPlugin({ exclude: ['@modelcontextprotocol/sdk'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'app/src/main/index.ts'),
          worker: resolve(__dirname, 'app/src/main/agent-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'app/src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'app/src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'app/src/renderer/index.html') }
      }
    }
  }
})
