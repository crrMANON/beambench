import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';

const identifier = /^[a-z][a-z0-9-]*$/;
const definitions = {
  lens: { f: [-10, 10] },
  thickLens: { R1: [-10, 10], R2: [-10, 10], n: [1, 3], thickness: [0.00001, 0.05] },
  mirror: { flat: 'boolean', R: [-10, 10], refl: [0, 1], n: [1, 3], thickness: [0.00001, 0.05] },
  polarizer: { axisDeg: [-360, 360] },
  waveplate: { axisDeg: [-360, 360], delta: [-2 * Math.PI, 2 * Math.PI], type: ['HWP', 'QWP'] },
  faraday: { phiDeg: [-360, 360] },
  beamSplitter: { R: [0, 1], polarizing: 'boolean', polTransmit: ['Vertical', 'Horizontal'] },
  multimeter: {},
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** API v1 is data only; each exposed factory belongs to the original laboratory. */
export function validateLibrary(value, origin = 'library.json') {
  const fail = (field, message) => { throw new Error(`${origin}: ${field}: ${message}`); };
  const keys = (record, allowed, field) => {
    if (!object(record)) fail(field, 'must be an object');
    for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${field}.${key}`, 'unknown field');
  };
  keys(value, ['apiVersion', 'id', 'name', 'version', 'presets'], 'library');
  if (value.apiVersion !== 1) fail('apiVersion', 'supported version is 1');
  if (typeof value.id !== 'string' || !identifier.test(value.id)) fail('id', 'expected a lowercase identifier');
  if (typeof value.name !== 'string' || !value.name.trim()) fail('name', 'required');
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) fail('version', 'expected major.minor.patch');
  if (!Array.isArray(value.presets) || value.presets.length === 0) fail('presets', 'must be a nonempty array');
  const ids = new Set();
  for (const [index, preset] of value.presets.entries()) {
    const field = `presets[${index}]`;
    keys(preset, ['id', 'name', 'factory', 'params'], field);
    if (typeof preset.id !== 'string' || !identifier.test(preset.id) || ids.has(preset.id)) fail(`${field}.id`, 'invalid or duplicate identifier');
    ids.add(preset.id);
    if (typeof preset.name !== 'string' || !preset.name.trim()) fail(`${field}.name`, 'required');
    if (typeof preset.factory !== 'string' || !Object.hasOwn(definitions, preset.factory)) fail(`${field}.factory`, 'unsupported native factory');
    const spec = definitions[preset.factory];
    keys(preset.params, Object.keys(spec), `${field}.params`);
    for (const [key, rule] of Object.entries(spec)) {
      const input = preset.params[key];
      if (input === undefined) fail(`${field}.params.${key}`, 'required explicitly');
      if (rule === 'boolean') {
        if (typeof input !== 'boolean') fail(`${field}.params.${key}`, 'expected boolean');
      } else if (typeof rule[0] === 'number') {
        if (typeof input !== 'number' || !Number.isFinite(input) || input < rule[0] || input > rule[1]) fail(`${field}.params.${key}`, `expected finite number in [${rule}]`);
      } else if (!rule.includes(input)) fail(`${field}.params.${key}`, `expected one of ${rule}`);
    }
    for (const key of ['f', 'R', 'R1', 'R2']) {
      if (Object.hasOwn(preset.params, key) && Math.abs(preset.params[key]) < 1e-6) fail(`${field}.params.${key}`, 'magnitude must be at least 1e-6 metres');
    }
  }
  return structuredClone(value);
}

/** Each installed directory is one package; source packages are not auto-installed. */
export function loadLibraries(directory = resolve('optics-libraries')) {
  if (!existsSync(directory)) return [];
  const libraries = [];
  const ids = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error(`${entry.name}: symlink packages are unsupported`);
    if (!entry.isDirectory()) continue;
    const file = join(directory, entry.name, 'library.json');
    if (!existsSync(file)) throw new Error(`${file}: missing manifest`);
    if (lstatSync(file).isSymbolicLink()) throw new Error(`${file}: symlink manifest is unsupported`);
    let raw;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`${file}: invalid JSON: ${error.message}`); }
    const library = validateLibrary(raw, file);
    if (ids.has(library.id)) throw new Error(`${file}: duplicate library id ${library.id}`);
    ids.add(library.id);
    libraries.push(library);
  }
  return libraries;
}
