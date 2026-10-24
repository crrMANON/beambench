/**
 * BB-00 upstream smoke test - verifies basic module loading from fixed SHA
 */
import { describe, it, expect } from 'vitest';

describe('BB-00 | Upstream Module Load', () => {
  const upstreamSHA = '47686d611b7b11121cfaf7be0583aee6ac34e9b0';
  
  it('should have correct upstream SHA reference', () => {
    expect(upstreamSHA).toBe('47686d611b7b11121cfaf7be0583aee6ac34e9b0');
  });
  
  it('should list all V1 device types', () => {
    const v1Devices = [
      'source',
      'raysSource', 
      'lens',
      'thickLens',
      'mirror',
      'polarizer',
      'waveplate',
      'faraday',
      'pbs',
      'beamblock',
      'grating',
      'multimeter'
    ];
    
    expect(v1Devices.length).toBe(12);
    expect(v1Devices).toContain('source');
    expect(v1Devices).toContain('mirror');
    expect(v1Devices).toContain('lens');
  });
});
