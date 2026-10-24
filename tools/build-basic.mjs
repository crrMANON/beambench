import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'basic', '--outDir', 'dist-basic'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/make-standalone.mjs', 'dist-basic'], { stdio: 'inherit' });
