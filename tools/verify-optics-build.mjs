import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';

const root = process.cwd();
const evidence = resolve('artifacts/modular-optics-v1');
const fixture = join(evidence, 'build-fixture');
rmSync(fixture, { recursive: true, force: true });
mkdirSync(fixture, { recursive: true });
for (const path of ['src', 'tools', 'beambench.html', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json']) {
  cpSync(resolve(path), join(fixture, path), { recursive: true });
}
symlinkSync(resolve('node_modules'), join(fixture, 'node_modules'), 'dir');
mkdirSync(join(fixture, 'optics-libraries'));
mkdirSync(evidence, { recursive: true });
mkdirSync(join(evidence, 'baseline/dist'), { recursive: true });
writeFileSync(join(evidence, 'baseline/dist/beambench-standalone.html'), gunzipSync(readFileSync(resolve('tests/fixtures/original-standalone.html.gz'))));
execFileSync(process.execPath, ['tools/pack-optics.mjs'], { cwd: root, stdio: 'inherit' });
const results = [];
function build(name, mode, installed) {
  const expected = Array.isArray(installed) ? installed : installed ? ['polarization'] : [];
  const result = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--mode', mode, '--outDir', name], { cwd: fixture, encoding: 'utf8' });
  writeFileSync(join(evidence, `${name}.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `${name}: see build log`);
  execFileSync(process.execPath, [join(fixture, 'tools/make-standalone.mjs'), name], { cwd: fixture, stdio: 'inherit' });
  const metadata = JSON.parse(readFileSync(join(fixture, name, 'optics-build.json'), 'utf8'));
  assert.equal(metadata.profile, mode);
  assert.deepEqual(metadata.libraries.map(library => library.id).sort(), [...expected].sort());
  const sizes = { polarization: 7, 'geometric-optics': 8, 'gaussian-beams': 5 };
  for (const library of metadata.libraries) assert.equal(library.presets.length, sizes[library.id]);
  const html = readFileSync(join(fixture, name, 'beambench-standalone.html'), 'utf8');
  // The last script is the generated classic bundle. Parsing does not execute the app.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  new vm.Script(scripts.at(-1)[1]);
  assert.ok(!/<script[^>]+src=/.test(html), 'standalone must not fetch library scripts');
  results.push({ name, ...metadata, standaloneSyntax: 'passed' });
}
build('original-empty', 'original', false);
build('basic-empty', 'basic', false);
execFileSync('unzip', ['-q', resolve('release/polarization-1.0.0.zip'), '-d', join(fixture, 'optics-libraries')]);
build('original-installed', 'original', true);
build('basic-installed', 'basic', true);
const manifest = join(fixture, 'optics-libraries/polarization/library.json');
const valid = readFileSync(manifest, 'utf8');
writeFileSync(manifest, valid.replace('"apiVersion": 1', '"apiVersion": 99'));
const rejected = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], { cwd: fixture, encoding: 'utf8' });
assert.notEqual(rejected.status, 0);
assert.match(rejected.stderr, /apiVersion/);
writeFileSync(join(evidence, 'invalid-library.log'), rejected.stdout + rejected.stderr);
rmSync(join(fixture, 'optics-libraries/polarization'), { recursive: true });
build('basic-removed', 'basic', false);
const install = id => execFileSync('unzip', ['-q', resolve(`release/${id}-1.0.0.zip`), '-d', join(fixture, 'optics-libraries')]);
const remove = id => rmSync(join(fixture, 'optics-libraries', id), { recursive: true });
install('geometric-optics'); build('geometry-only', 'basic', ['geometric-optics']); remove('geometric-optics');
install('gaussian-beams'); build('gaussian-only', 'basic', ['gaussian-beams']);
install('geometric-optics'); install('polarization');
build('all-basic', 'basic', ['geometric-optics', 'gaussian-beams', 'polarization']);
build('all-original', 'original', ['geometric-optics', 'gaussian-beams', 'polarization']);
remove('geometric-optics'); build('without-geometry', 'basic', ['gaussian-beams', 'polarization']);
install('geometric-optics'); remove('gaussian-beams'); build('without-gaussian', 'basic', ['geometric-optics', 'polarization']);
remove('polarization'); build('geometry-after-removals', 'basic', ['geometric-optics']);
writeFileSync(join(evidence, 'build-verification.json'), JSON.stringify({ results, invalidApiRejected: true, zipInstallRemove: true }, null, 2) + '\n');
console.log('PASS: original/basic, three independent ZIP libraries, install/remove, invalid API rejection, standalone syntax');
