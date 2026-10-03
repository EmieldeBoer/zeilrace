import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const convexUrl = env.VITE_CONVEX_URL ?? ''
  // A local Convex backend (bunx convex dev without an account) only listens on
  // 127.0.0.1. Proxy its /api routes through Vite so other devices on the
  // network (tailnet, phone) reach it through the dev server's origin.
  const isLocalConvex = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(convexUrl)

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      // Vite refuses unknown Host headers. Allow tailnet names (tailscale
      // serve) and the machine's own .local name.
      allowedHosts: ['.ts.net', '.local', 'sjoerds-mac-mini'],
      proxy: isLocalConvex
        ? { '/api': { target: convexUrl, ws: true, changeOrigin: true } }
        : undefined,
    },
  }
})
