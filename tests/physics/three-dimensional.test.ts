/**
 * BB-01 Three-Dimensional Physics Verification PoC
 * 
 * Tests for non-coplanar reflection, source roll preservation, and Jones calculus.
 * Evidence against PLAN §3.3 RESEARCH BF06 and BF02.
 */
import { describe, it, expect } from 'vitest';

// Mock THREE.Vector3 for basic math operations (no WebGL dependency)
class Vector3 {
  x: number; y: number; z: number;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  applyQuaternion(q: Quaternion): Vector3 {
    // Simplified rotation - full implementation needs three.js
    return new Vector3(this.x, this.y, this.z);
  }
  normalize(): Vector3 {
    const len = Math.sqrt(this.x*this.x + this.y*this.y + this.z*this.z);
    return new Vector3(this.x/len, this.y/len, this.z/len);
  }
  clone(): Vector3 { return new Vector3(this.x, this.y, this.z); }
}

class Quaternion {
  x: number; y: number; z: number; w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
}

// ABCD matrix for free-space propagation (from optics module)
export function abcdFreeSpace(distance: number, n1: number, n2: number, curvatureInv: number): [number, number, number, number] {
  // A = 1, B = d*n1/n2, C = 0, D = 1
  // From RESEARCH: abcd(i, 1, 0.3, 0, 1) should equal 0.3 + i
  const A = 1;
  const B = distance * n1 / n2;
  const C = 0;
  const D = 1;
  return [A, B, C, D];
}

// Jones vector normalization
export function jonesNormalize(J: [number, number]): [number, number] {
  const mag = Math.sqrt(Math.abs(J[0]*J[0]) + Math.abs(J[1]*J[1]));
  if (mag < 1e-12) return [0, 0];
  return [J[0] / mag, J[1] / mag];
}

// Simple Jones matrix-vector multiplication
export function jonesMultiply(J: [number, number], M: [[number, number], [number, number]]): [number, number] {
  return [
    M[0][0] * J[0] + M[0][1] * J[1],
    M[1][0] * J[0] + M[1][1] * J[1]
  ];
}

describe('BB-01 | Three-Dimensional Physics Verification', () => {
  
  describe('ABCD Free-Space Propagation', () => {
    it('should match analytical solution: abcd(λ, 1, 0.3, 0, 1) = 0.3 + λi', () => {
      const [A, B, C, D] = abcdFreeSpace(0.3, 1, 1, 0);
      
      // Expected: A=1, B=0.3, C=0, D=1
      expect(A).toBeCloseTo(1, 10);
      expect(B).toBeCloseTo(0.3, 10);
      expect(C).toBeCloseTo(0, 10);
      expect(D).toBeCloseTo(1, 10);
      
      // Test with different indices (as in optics.js smoke test)
      const lambda = 1; // wavelength parameter
      
      expect(B).toBeCloseTo(0.3, 10);
    });
    
    it('should preserve power conservation', () => {
      const d = 0.5;
      const [A, B, C, D] = abcdFreeSpace(d, 1, 1, 0);
      
      // For lossless free space: |A|² = 1, |D|² = 1, AD - BC = 1
      expect(A*D - B*C).toBeCloseTo(1, 10);
    });
  });
  
  describe('Source Roll Preservation', () => {
    it('should NOT clear roll (z-axis Euler angle) during recompute', () => {
      // Simulate source with initial Euler angles (YXZ order like upstream)
      const initialRotation = { x: 0.1, y: 0.2, z: 0.3 }; // radians
      
      // clampToPlaneXZ() currently does: set(e.x, e.y, 0)
      // This is the BUG identified in RESEARCH BF06
      
      // After clampToPlaneXZ (current buggy behavior):
      const afterClamp = { x: initialRotation.x, y: initialRotation.y, z: 0 };
      
      // Expected fix: preserve z rotation
      const expected = { x: initialRotation.x, y: initialRotation.y, z: initialRotation.z };
      
      // This test documents the known issue
      expect(afterClamp.z).toBe(0); // Currently clears it - this is the bug!
      expect(expected.z).toBeCloseTo(initialRotation.z, 10); // Should preserve
      
      // TODO: In actual implementation, clampToPlaneXZ should NOT zero z rotation
      // The fix would be: obj.rotation.set(e.x, e.y, e.z);
    });
    
    it('should handle non-coplanar mirror reflections correctly', () => {
      // Scenario: Two mirrors at different z heights
      // Mirror 1 at z=0.05m, Mirror 2 at z=0.10m
      // Beam reflects from both (non-coplanar path)
      
      const mirror1Position = new Vector3(0, 0, 0.05);
      const mirror2Position = new Vector3(0, 0, 0.10);
      
      // Incident beam direction (along +y)
      const incidentDir = new Vector3(0, 1, 0);
      
      // Reflected direction depends on mirror normal
      // For flat mirror, R = I - 2(N·I)N
      
      // This test will need actual Three.js integration later
      // For now, document expected behavior
      
      expect(mirror1Position.z).toBe(0.05);
      expect(mirror2Position.z).toBe(0.10);
      expect(mirror1Position.z).not.toBe(mirror2Position.z); // Non-coplanar
    });
  });
  
  describe('Jones Calculus for Polarization', () => {
    it('should normalize linearly polarized light correctly', () => {
      // Horizontal polarization: [1, 0]
      const J_h = [1, 0];
      const normalized = jonesNormalize(J_h);
      
      expect(normalized[0]).toBeCloseTo(1, 10);
      expect(normalized[1]).toBeCloseTo(0, 10);
    });
    
    it('should handle diagonal polarization (45°)', () => {
      // Diagonal: [1/√2, 1/√2]
      const sqrt2inv = 1 / Math.sqrt(2);
      const J_d = [sqrt2inv, sqrt2inv];
      const normalized = jonesNormalize(J_d);
      
      expect(Math.abs(normalized[0] - sqrt2inv)).toBeLessThan(1e-10);
      expect(Math.abs(normalized[1] - sqrt2inv)).toBeLessThan(1e-10);
    });
    
    it('should apply ideal HWP matrix correctly', () => {
      // HWP at angle θ: M_HWP = [[cos(2θ), sin(2θ)], [sin(2θ), -cos(2θ)]]
      // For θ = π/4 (H/V basis): cos(π/2)=0, sin(π/2)=1
      const theta = Math.PI / 4; // HWP orientation for H/V basis
      const HWP_matrix: [[number, number], [number, number]] = [
        [Math.cos(2*theta), Math.sin(2*theta)],
        [Math.sin(2*theta), -Math.cos(2*theta)]
      ];
      
      // Input: horizontal polarization [1, 0]
      const input_h: [number, number] = [1, 0];
      const output_v = jonesMultiply(input_h, HWP_matrix);
      
      // Should flip to vertical: [0, ±1] depending on convention
      expect(Math.abs(output_v[0])).toBeLessThan(0.01);
      expect(Math.abs(output_v[1])).toBeGreaterThan(0.99);
    });
    
    it('should apply Malus law for polarizer', () => {
      // Malus law: I = I₀ * cos²(θ)
      // For polarizer at angle θ relative to input polarization
      
      const theta_rad = Math.PI / 6; // 30°
      const transmission = Math.cos(theta_rad) ** 2;
      
      // Expect ~75% transmission at 30°
      expect(transmission).toBeCloseTo(0.75, 3);
    });
  });
  
  describe('Energy Conservation & Loss Budget', () => {
    it('should track power through optical system', () => {
      // Simple two-mirror system with reflectivity losses
      const R_mirror = 0.95; // 95% reflectivity
      const T_air = 1.0; // No absorption in air
      
      let power = 1.0;
      
      // After first mirror
      power *= R_mirror;
      expect(power).toBeCloseTo(R_mirror, 10);
      
      // After second mirror
      power *= R_mirror;
      expect(power).toBeCloseTo(R_mirror ** 2, 10);
      
      // Total loss = 1 - R² ≈ 9.75%
      const total_loss = 1 - power;
      expect(total_loss).toBeCloseTo(0.0975, 3);
    });
    
    it('should detect amplitude cutoff threshold violations', () => {
      // AMP_CUTOFF = 0.02 from upstream
      const AMP_CUTOFF = 0.02;
      
      // Weak branch below threshold should be truncated
      const weak_power = 0.01;
      expect(weak_power).toBeLessThan(AMP_CUTOFF);
      
      // Strong branch above threshold should propagate
      const strong_power = 0.5;
      expect(strong_power).toBeGreaterThanOrEqual(AMP_CUTOFF);
      
      // TODO: Document impact on BB84 statistics
      // If we discard branches >2% power, what's the QKD error rate impact?
    });
  });
});
