#!/usr/bin/env node
/**
 * BB-14 release packaging.
 *
 * Produces a source release with:
 * - the standalone single-file build (works from file://)
 * - source, tests, tools, scenarios, docs and examples
 * - SHA-256 checksums and a machine-readable manifest
 *
 * Usage: npm run release
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const date = new Date().toISOString().slice(0, 10);
const name = `${pkg.name}-${pkg.version}-${date}`;
const releaseDir = resolve(root, 'release');
const stagingRoot = resolve(releaseDir, '.staging');
const staging = resolve(stagingRoot, name);

const SOURCE_PATHS = [
  'src', 'tests', 'tools', 'scenarios', 'docs', 'examples', 'public',
  'beambench.html', 'index.html', 'NOTICE', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'README.md', 'PLAN.md', 'AGENTS.md',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'vitest.config.ts', 'playwright.config.ts', 'eslint.config.js', '.npmrc',
  '.gitignore', 'optics-libraries', 'library-packages', 'playwright.optics.config.ts', 'playwright.models.config.ts',
];

function copy(relative) {
  const from = resolve(root, relative);
  if (!existsSync(from)) {
    console.warn(`skip missing path: ${relative}`);
    return;
  }
  cpSync(from, resolve(staging, relative), { recursive: true, filter: path => basename(path) !== '.DS_Store' });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(relative, output = []) {
  const absolute = resolve(staging, relative);
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const rel = join(relative, entry.name);
    if (entry.isDirectory()) walk(rel, output);
    else output.push(rel);
  }
  return output;
}

const builds = [
  ['build:standalone', 'dist'], ['build:basic', 'dist-basic'],
  ['build:detailed', 'dist-detailed'], ['build:basic:detailed', 'dist-basic-detailed'],
];
for (const [command] of builds) {
  console.log(`Building ${command}…`);
  execFileSync('npm', ['run', command], { cwd: root, stdio: 'inherit' });
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

for (const relative of SOURCE_PATHS) copy(relative);

// Ship all four profiles, omitting source maps.
for (const [, directory] of builds) {
  mkdirSync(resolve(staging, directory, 'assets'), { recursive: true });
  for (const file of ['beambench.html', 'beambench-standalone.html', 'optics-build.json']) copy(`${directory}/${file}`);
  for (const file of readdirSync(resolve(root, directory, 'assets'))) {
    if (file.endsWith('.map')) continue;
    cpSync(resolve(root, directory, 'assets', file), resolve(staging, directory, 'assets', file));
  }
}

const files = walk('.').sort();
const manifest = {
  name: pkg.name,
  version: pkg.version,
  releasedAt: new Date().toISOString(),
  upstream: {
    repository: 'https://github.com/visuphy/BeamBench',
    revision: '47686d611b7b11121cfaf7be0583aee6ac34e9b0',
    license: 'GPL-3.0-or-later',
  },
  entrypoints: {
    development: 'npm run dev',
    preview: 'npm run build && npm run preview',
    standalone: 'dist/beambench-standalone.html',
    basic: 'dist-basic/beambench-standalone.html',
    detailed: 'dist-detailed/beambench-standalone.html',
    basicDetailed: 'dist-basic-detailed/beambench-standalone.html',
  },
  files,
  checksums: Object.fromEntries(
    files.map((file) => [file, sha256(resolve(staging, file))])
  ),
};

writeFileSync(resolve(staging, 'RELEASE_MANIFEST.json'), JSON.stringify(manifest, null, 2));
writeFileSync(
  resolve(staging, 'SHA256SUMS'),
  Object.entries(manifest.checksums)
    .map(([file, digest]) => `${digest}  ${file}`)
    .join('\n') + '\n'
);

mkdirSync(releaseDir, { recursive: true });
const tarball = resolve(releaseDir, `${name}.tar.gz`);
const zipball = resolve(releaseDir, `${name}.zip`);
// zip updates an existing archive in place and retains removed members.
rmSync(zipball, { force: true });
rmSync(tarball, { force: true });
execFileSync('tar', ['-czf', tarball, '-C', stagingRoot, name], { stdio: 'inherit' });
execFileSync('zip', ['-qr', zipball, name], { cwd: stagingRoot, stdio: 'inherit' });

const assets = new Set(['RELEASE_MANIFEST.json', 'SHA256SUMS']);
const summary = {
  name,
  tarball,
  tarballBytes: statSync(tarball).size,
  zipball,
  zipballBytes: statSync(zipball).size,
  fileCount: files.length,
  standaloneBytes: manifest.checksums['dist/beambench-standalone.html']
    ? statSync(resolve(staging, 'dist/beambench-standalone.html')).size
    : null,
  releases: files.filter((file) => assets.has(basename(file))),
};

rmSync(stagingRoot, { recursive: true, force: true });
console.log(JSON.stringify(summary, null, 2));
