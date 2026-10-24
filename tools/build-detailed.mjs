import { execFileSync } from 'node:child_process';
const basic = process.argv.includes('--basic');
const mode = basic ? 'basic-detailed' : 'detailed';
const out = basic ? 'dist-basic-detailed' : 'dist-detailed';
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', mode, '--outDir', out], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/make-standalone.mjs', out], { stdio: 'inherit' });
