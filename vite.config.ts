import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5175,
    proxy: {
      // Proxy EODHD API requests to avoid CORS restrictions in the browser.
      // Usage: fetch('/api/eodhd/real-time/AAPL.US?api_token=...&fmt=json')
      '/api/eodhd': {
        target: 'https://eodhd.com/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/eodhd/, ''),
      },
      // Proxy Yahoo Finance chart requests to avoid CORS restrictions.
      // Usage: fetch('/api/yahoo/v8/finance/chart/USDPLN=X')
      // /api/yahoo2 is a fallback host (query2) rotated in on 429 responses.
      '/api/yahoo2': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo2/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
            proxyReq.setHeader('Accept', 'application/json, text/plain, */*')
            proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9')
          })
        },
      },
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
            proxyReq.setHeader('Accept', 'application/json, text/plain, */*')
            proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9')
          })
        },
      },
      // Proxy CoinGecko free/demo API (x_cg_demo_api_key).
      '/api/coingecko': {
        target: 'https://api.coingecko.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/coingecko/, ''),
      },
      // Proxy CoinGecko Pro API (x_cg_pro_api_key, paid plans).
      '/api/coingeckopro': {
        target: 'https://pro-api.coingecko.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/coingeckopro/, ''),
      },
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
      },
      '/api/bankier': {
        target: 'https://www.bankier.pl',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bankier/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Stable third-party code in its own chunks, so an app-only change
        // doesn't make returning visitors re-download it. The object form pulls
        // each entry's dependencies in with it (recharts → d3, redux toolkit…),
        // except those already claimed by an earlier chunk (react).
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          'web3icons-meta': ['@web3icons/common'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    alias: {
      // pdf.js's default build targets browsers and touches DOMMatrix at import
      // time; tests run in Node, so point them at the legacy build instead.
      'pdfjs-dist': path.resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
    },
  },
})
