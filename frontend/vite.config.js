import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import viteCompression from 'vite-plugin-compression'

// ── Cesium Global Plugin ──────────────────────────────────────────────────────
// Vite produces ESM output. In ESM, rollupOptions.globals is IGNORED — it only
// works for IIFE/UMD. So `import { X } from 'cesium'` stays as a bare specifier
// in the bundle and the browser throws "Failed to resolve module specifier".
//
// Fix: transform all cesium imports at build-time into `window.Cesium` access.
// window.Cesium is always available because vite-plugin-cesium injects a plain
// <script src="/cesium/Cesium.js"> which runs synchronously BEFORE any module.
function cesiumGlobalsPlugin() {
  return {
    name: 'cesium-globals',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(jsx?|tsx?)$/.test(id)) return null;
      if (!code.includes('cesium')) return null;

      let result = code;

      // import('cesium') or import('cesium/Cesium')  →  Promise.resolve(window.Cesium)
      result = result.replace(
        /import\s*\(\s*['"]cesium(?:\/Cesium)?['"]\s*\)/g,
        'Promise.resolve(window.Cesium)'
      );

      // import * as Cesium from 'cesium'  →  const Cesium = window.Cesium
      result = result.replace(
        /import\s*\*\s*as\s+(\w+)\s+from\s*['"]cesium(?:\/Cesium)?['"];?/g,
        (_, alias) => `const ${alias} = window.Cesium;`
      );

      // import { X, Y as Z } from 'cesium'  →  const { X, Y: Z } = window.Cesium
      result = result.replace(
        /import\s*\{([^}]+)\}\s*from\s*['"]cesium(?:\/Cesium)?['"];?/g,
        (_, imports) => {
          const destructuring = imports.replace(/\b(\w+)\s+as\s+(\w+)\b/g, '$1: $2');
          return `const {${destructuring}} = window.Cesium;`;
        }
      );

      // import Cesium from 'cesium'  →  const Cesium = window.Cesium
      result = result.replace(
        /import\s+(\w+)\s+from\s*['"]cesium(?:\/Cesium)?['"];?/g,
        (_, name) => `const ${name} = window.Cesium;`
      );

      return result === code ? null : { code: result, map: null };
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    cesiumGlobalsPlugin(), // Must be before cesium() — rewrites imports first
    cesium(),              // Copies /cesium/ assets & injects <script src="/cesium/Cesium.js">
    viteCompression({ algorithm: 'gzip', ext: '.gz' }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
  ],
  resolve: {
    alias: {
      'cesium/Cesium': 'cesium',
    },
  },
  optimizeDeps: {
    exclude: ['cesium'], // Don't let esbuild pre-bundle cesium (our plugin handles it)
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

