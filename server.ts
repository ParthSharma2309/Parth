/**
 * DocuMind Server Entry Point
 * In production (started by `node server.ts`), executes the compiled server.js bundle.
 * If server.js is not yet built, compiles it synchronously using esbuild.
 * In development (started by `tsx server.ts`), directly imports server/index.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compiledServer = path.resolve(__dirname, 'server.js');

const isDev =
  process.env.npm_lifecycle_event === 'dev' ||
  process.execArgv.some((arg) => arg.includes('tsx'));

if (isDev) {
  await import('./server/index.ts');
} else {
  if (!fs.existsSync(compiledServer)) {
    const { buildSync } = await import('esbuild');
    buildSync({
      entryPoints: [path.resolve(__dirname, 'server/index.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: compiledServer,
      packages: 'external',
    });
  }
  await import('./server.js');
}
