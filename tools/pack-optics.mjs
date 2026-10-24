import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateLibrary } from './optics-libraries.mjs';

const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--library' && /^[a-z][a-z0-9-]*$/.test(args[1]))) throw new Error('Usage: npm run pack:optics [-- --library <id>]');
const sources = readdirSync('library-packages', { withFileTypes: true }).filter((entry) => entry.isDirectory() && (!args.length || entry.name === args[1]));
if (!sources.length) throw new Error(`Unknown library: ${args[1]}`);
mkdirSync('release', { recursive: true });
for (const entry of sources) {
  const source = resolve('library-packages', entry.name);
  const library = validateLibrary(JSON.parse(readFileSync(resolve(source, 'library.json'), 'utf8')));
  if (library.id !== entry.name) throw new Error(`${entry.name}: directory must match library id`);
  const output = resolve(`release/${library.id}-${library.version}.zip`);
  rmSync(output, { force: true });
  execFileSync('zip', ['-qr', output, entry.name, '-x', '*/.DS_Store', '*/__MACOSX/*'], { cwd: resolve('library-packages'), stdio: 'inherit' });
  console.log(output);
}
