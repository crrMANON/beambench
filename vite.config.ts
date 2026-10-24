import { defineConfig } from 'vite';
import { resolve } from 'path';
import { loadLibraries } from './tools/optics-libraries.mjs';

export default defineConfig(({ mode }) => {
  const libraries = loadLibraries();
  const profile = mode === 'basic' ? 'basic' : 'original';
  console.log(`[optics] profile=${profile}; libraries=${libraries.map((library) => `${library.id}@${library.version}`).join(',') || '(none)'}`);
  return {
  plugins: [{
    name: 'optics-build-record',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'optics-build.json', source: JSON.stringify({
        apiVersion: 1, profile,
        libraries: libraries.map((library) => ({ id: library.id, version: library.version, presets: library.presets.map((preset) => preset.id) })),
      }, null, 2) });
    },
  }],
  define: {
    __BB_BUILD__: JSON.stringify(new Date().toISOString()),
    __BB_OPTICS_LIBRARIES__: JSON.stringify(libraries),
    __BB_LIBRARY_PROFILE__: JSON.stringify(profile),
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'beambench.html')
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
  };
});
