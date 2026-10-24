/**
 * BB-07 BB84 Event Sampler
 *
 * Produces protocol statistics from a four-channel (H/V/D/A) optical model:
 * - Alice encodes a random bit in a random basis (Z or X)
 * - Bob measures in an independently chosen basis
 * - Loss, detector efficiency, dark counts and basis misalignment are applied
 * - Sifting keeps same-basis single-click events; double clicks are discarded
 *
 * The model is deliberately decoupled from rendering: the optical transmission
 * is an input (derived from trace/measurement in the assembled experiment).
 * Results are deterministic for a given seed and cached by optical hash +
 * engine commit so stale optics can never reuse old statistics.
 */

import { createRng, PRNG_VERSION } from '../core/rng';

export const BB84_ENGINE_COMMIT = 'bb84-v1';
export { createRng, PRNG_VERSION };

export type Basis = 'Z' | 'X';
export type DetectorPort = 'H' | 'V' | 'D' | 'A';

export const DETECTOR_PORTS: readonly DetectorPort[] = ['H', 'V', 'D', 'A'];

export interface Bb84OpticalModel {
  /** End-to-end photon transmission before detector efficiency (0..1). */
  transmission: number;
  /** Detector efficiency (0..1). */
  detectorEfficiency: number;
  /** Per-detector dark-count probability per pulse (0..1). */
  darkCountProbability: number;
  /** Polarization misalignment angle in radians. */
  misalignmentRad: number;
}

export interface Bb84Options {
  pulses: number;
  seed: number;
  model: Bb84OpticalModel;
}

export interface Bb84Report {
  engineCommit: string;
  prngVersion: string;
  opticalHash: string;
  seed: number;
  pulses: number;
  counts: {
    noClick: number;
    singleClick: number;
    doubleClick: number;
    basisMatch: number;
  };
  sifted: {
    length: number;
    errors: number;
    /** Quantum bit error rate over the sifted key. */
    qber: number;
  };
  /** Sifted key length / pulses. */
  gain: number;
  perDetector: Record<DetectorPort, number>;
}

/** Port that a prepared state occupies when measured in the matching basis. */
export function statePort(basis: Basis, bit: 0 | 1): DetectorPort {
  if (basis === 'Z') return bit === 0 ? 'H' : 'V';
  return bit === 0 ? 'D' : 'A';
}

/** Bit encoded by a port in its own basis. */
export function portBit(port: DetectorPort): 0 | 1 {
  return port === 'H' || port === 'D' ? 0 : 1;
}

/**
 * Exact click probabilities for one prepared state and Bob's basis.
 * noClick + Σ single-port probabilities + multiClick = 1.
 */
export function clickProbabilities(
  model: Bb84OpticalModel,
  aliceBasis: Basis,
  aliceBit: 0 | 1,
  bobBasis: Basis
): { ports: Record<DetectorPort, number>; noClick: number; multiClick: number } {
  validateModel(model);

  const pDark = model.darkCountProbability;
  // Probability that a photon reaches and is detected.
  const pPhoton = model.transmission * model.detectorEfficiency;
  const pErr = Math.sin(model.misalignmentRad) ** 2;

  // Exactly one photon at most: distribute its probability over ports.
  const photonPort: Record<DetectorPort, number> = { H: 0, V: 0, D: 0, A: 0 };

  if (aliceBasis === bobBasis) {
    const correct = statePort(aliceBasis, aliceBit);
    const wrong = statePort(aliceBasis, aliceBit === 0 ? 1 : 0);
    photonPort[correct] = pPhoton * (1 - pErr);
    photonPort[wrong] = pPhoton * pErr;
  } else {
    // Conjugate basis: the outcome is random within Bob's basis.
    photonPort[statePort(bobBasis, 0)] = pPhoton / 2;
    photonPort[statePort(bobBasis, 1)] = pPhoton / 2;
  }

  const noDarkAnywhere = (1 - pDark) ** DETECTOR_PORTS.length;
  // A single click needs no other dark count, whether the click is the photon
  // itself or a dark count in the otherwise empty case.
  const darkSingle = pDark * (1 - pDark) ** (DETECTOR_PORTS.length - 1);

  const ports: Record<DetectorPort, number> = { H: 0, V: 0, D: 0, A: 0 };
  for (const port of DETECTOR_PORTS) {
    ports[port] = (1 - pPhoton) * darkSingle + photonPort[port] * (1 - pDark) ** 3;
  }

  const noClick = (1 - pPhoton) * noDarkAnywhere;
  const singleClick = DETECTOR_PORTS.reduce((sum, port) => sum + ports[port], 0);

  return { ports, noClick, multiClick: Math.max(0, 1 - noClick - singleClick) };
}

/** Stable hash of the optical model (cache key component). */
export function opticalHash(model: Bb84OpticalModel): string {
  const normalized = {
    version: BB84_ENGINE_COMMIT,
    transmission: model.transmission,
    detectorEfficiency: model.detectorEfficiency,
    darkCountProbability: model.darkCountProbability,
    misalignmentRad: model.misalignmentRad,
  };
  // FNV-1a 32-bit is sufficient for cache invalidation.
  const text = JSON.stringify(normalized);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function validateModel(model: Bb84OpticalModel): void {
  for (const key of [
    'transmission',
    'detectorEfficiency',
    'darkCountProbability',
    'misalignmentRad',
  ] as const) {
    const value = model?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid optical model: ${key} must be finite`);
    }
  }
  if (model.transmission < 0 || model.transmission > 1) {
    throw new Error('transmission must be in [0,1]');
  }
  if (model.detectorEfficiency < 0 || model.detectorEfficiency > 1) {
    throw new Error('detectorEfficiency must be in [0,1]');
  }
  if (model.darkCountProbability < 0 || model.darkCountProbability > 1) {
    throw new Error('darkCountProbability must be in [0,1]');
  }
}

/** Run the sampler without caching. */
export function runBb84(options: Bb84Options): Bb84Report {
  const { pulses, seed, model } = options;
  validateModel(model);
  if (!Number.isInteger(pulses) || pulses <= 0 || pulses > 100_000) {
    throw new Error('pulses must be an integer in (0, 100000]');
  }
  if (!Number.isInteger(seed)) {
    throw new Error('seed must be an integer');
  }

  const rng = createRng(seed);
  const pPhoton = model.transmission * model.detectorEfficiency;
  const pDark = model.darkCountProbability;
  const pErr = Math.sin(model.misalignmentRad) ** 2;

  let noClick = 0;
  let singleClick = 0;
  let doubleClick = 0;
  let basisMatch = 0;
  let siftedLength = 0;
  let errors = 0;
  const perDetector: Record<DetectorPort, number> = { H: 0, V: 0, D: 0, A: 0 };

  for (let i = 0; i < pulses; i++) {
    const aliceBit: 0 | 1 = rng() < 0.5 ? 0 : 1;
    const aliceBasis: Basis = rng() < 0.5 ? 'Z' : 'X';
    const bobBasis: Basis = rng() < 0.5 ? 'Z' : 'X';

    if (aliceBasis === bobBasis) basisMatch++;

    const clicks = new Set<DetectorPort>();

    // Photon click (if it arrives).
    if (rng() < pPhoton) {
      let port: DetectorPort;
      if (aliceBasis === bobBasis) {
        const flip = rng() < pErr;
        const bit = flip ? (aliceBit === 0 ? 1 : 0) : aliceBit;
        port = statePort(aliceBasis, bit);
      } else {
        port = statePort(bobBasis, rng() < 0.5 ? 0 : 1);
      }
      clicks.add(port);
    }

    // Dark counts on every detector.
    for (const port of DETECTOR_PORTS) {
      if (rng() < pDark) clicks.add(port);
    }

    if (clicks.size === 0) {
      noClick++;
    } else if (clicks.size > 1) {
      doubleClick++;
    } else {
      singleClick++;
      const port = [...clicks][0];
      perDetector[port]++;

      if (aliceBasis === bobBasis) {
        siftedLength++;
        if (portBit(port) !== aliceBit) errors++;
      }
    }
  }

  return {
    engineCommit: BB84_ENGINE_COMMIT,
    prngVersion: PRNG_VERSION,
    opticalHash: opticalHash(model),
    seed,
    pulses,
    counts: { noClick, singleClick, doubleClick, basisMatch },
    sifted: {
      length: siftedLength,
      errors,
      qber: siftedLength > 0 ? errors / siftedLength : 0,
    },
    gain: siftedLength / pulses,
    perDetector,
  };
}

interface CacheEntry {
  key: string;
  report: Bb84Report;
}

/**
 * Bounded result cache keyed by engine commit + optical hash + pulse count + seed.
 * Any optical change produces a different key, so stale statistics are never reused.
 */
export class Bb84Runner {
  private cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private maxEntries: number;

  constructor(maxEntries = 32) {
    this.maxEntries = maxEntries;
  }

  static keyFor(options: Bb84Options): string {
    return [
      BB84_ENGINE_COMMIT,
      PRNG_VERSION,
      opticalHash(options.model),
      options.pulses,
      options.seed,
    ].join(':');
  }

  run(options: Bb84Options): Bb84Report {
    const key = Bb84Runner.keyFor(options);
    const cached = this.cache.get(key);
    if (cached) {
      this.hits++;
      return cached.report;
    }

    this.misses++;
    const report = runBb84(options);
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { key, report });
    return report;
  }

  getCacheStats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.cache.size };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
