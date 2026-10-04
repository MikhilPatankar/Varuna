import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import viteCompression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    viteCompression({ algorithm: 'gzip', ext: '.gz' }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
  ],
  resolve: {
    alias: {
      'cesium/Cesium': 'cesium'
    }
  },
  server: {
    allowedHosts: [
      'varunas.duckdns.org'
    ],
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          // Forward ALL response headers including custom X-* headers from FastAPI
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['access-control-expose-headers'] =
              Object.keys(proxyRes.headers)
                .filter(k => k.startsWith('x-'))
                .join(', ')
          })
        },
      },
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
