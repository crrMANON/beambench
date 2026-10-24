/**
 * Versioned deterministic PRNG shared by simulation modules.
 *
 * mulberry32-v1: stable across runs and platforms; changing the algorithm
 * requires bumping the version so cached results invalidate.
 */

export const PRNG_VERSION = 'mulberry32-v1';

export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
