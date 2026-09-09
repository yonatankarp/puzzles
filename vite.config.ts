import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * Name the service worker's cache after the build it belongs to.
 *
 * sw.js ships from public/, which Vite copies verbatim, so it cannot import
 * anything and cannot know what was built. It carries a __BUILD__ token
 * instead and this fills it in afterwards.
 *
 * The stamp is a hash of the emitted asset filenames, not the package version:
 * those filenames are content-hashed already, so the stamp changes when and
 * only when the bundle does. A version number would have been wrong in both
 * directions -- unchanged across a deploy that shipped new code, and changed
 * across a release that shipped none.
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    async writeBundle(_options, bundle) {
      const names = Object.keys(bundle).sort().join('\n');
      const stamp = createHash('sha256').update(names).digest('hex').slice(0, 12);
      const file = join(outDir, 'sw.js');
      const source = await readFile(file, 'utf8');
      if (!source.includes('__BUILD__')) {
        throw new Error('sw.js carries no __BUILD__ token to stamp');
      }
      await writeFile(file, source.replace('__BUILD__', stamp));
    }
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  // Relative asset paths so the build works from a project subpath
  // (…/puzzles/) without knowing the deploy URL at build time.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' }
});
