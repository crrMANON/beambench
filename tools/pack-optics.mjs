import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateLibrary } from './optics-libraries.mjs';

const source = resolve('library-packages/polarization');
const library = validateLibrary(JSON.parse(readFileSync(resolve(source, 'library.json'), 'utf8')));
mkdirSync('release', { recursive: true });
const output = resolve(`release/${library.id}-${library.version}.zip`);
rmSync(output, { force: true });
execFileSync('zip', ['-qr', output, 'polarization'], { cwd: resolve('library-packages'), stdio: 'inherit' });
console.log(output);
