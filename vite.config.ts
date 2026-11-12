import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Cesium's static assets (workers, third-party wasm, imagery, widget css) are copied verbatim to
// `<base>/cesium/`; index.html sets `window.CESIUM_BASE_URL` relative to the document, so the same
// build works under `/`, under a GitHub Pages sub-path and in `vite preview`.
const cesiumBuild = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: `${cesiumBuild}/{Workers,ThirdParty,Assets,Widgets}/**/*`,
          dest: 'cesium',
          // Drop `node_modules/cesium/Build/Cesium` so files land at cesium/Workers/…
          rename: { stripBase: 4 },
        },
      ],
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
});
