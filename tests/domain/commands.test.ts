/**
 * BB-03 Command Executor Tests - Unit Tests for Atomic Commands
 * 
 * Per PLAN §3.2:
 * - Optimistic concurrency control (expectedRevision)
 * - Failed commands don't modify history
 * - Idempotent by requestId
 * - Error codes per spec
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandExecutor, CommandRequest } from '../../src/domain/commands';

describe('BB-03 | Command Executor Core', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(() => {
    executor = new CommandExecutor();
  });
  
  it('should start with revision 0', () => {
    expect(executor.getRevision()).toBe(0);
  });
  
  it('should get current scene', () => {
    const scene = executor.getCurrentScene();
    expect(scene.schemaVersion).toBe(1);
    expect(Array.isArray(scene.elements)).toBe(true);
  });
  
  it('should increment revision on successful mutation', async () => {
    // Initial revision
    expect(executor.getRevision()).toBe(0);
    
    // Execute a state-changing command
    await executor.execute({
      protocolVersion: 1,
      requestId: 'test-001',
      expectedRevision: 0,
      method: 'add',
      args: {
        kind: 'mirror',
        pose: {
          position: [0.1, 0.1, 0],
          orientation: [0, 0, 0, 1],
        },
        mount: {
          pivotPoint: [0, 0, 0],
          axes: {
            tiltX: { min: -0.1, max: 0.1 },
            tiltY: { min: -0.1, max: 0.1 },
            rotationZ: { min: 0, max: Math.PI },
          },
        },
        props: {},
        active: true,
      },
    });
    
    // Revision should be incremented
    expect(executor.getRevision()).toBe(1);
  });
});

describe('BB-03 | Optimistic Concurrency Control', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(() => {
    executor = new CommandExecutor();
  });
  
  it('should reject STALE_REVISION when expectedRevision mismatch', async () => {
    const request: CommandRequest = {
      protocolVersion: 1,
      requestId: 'stale-test',
      expectedRevision: 5, // Wrong - current is 0
      method: 'get_state',
      args: null,
    };
    
    const response = await executor.execute(request);
    
    expect(response.ok).toBe(false);
    expect(response.error).toBe('STALE_REVISION');
    
    // Current revision should not change
    expect(executor.getRevision()).toBe(0);
  });
  
  it('should accept command with correct expectedRevision', async () => {
    const request: CommandRequest = {
      protocolVersion: 1,
      requestId: 'correct-rev',
      expectedRevision: 0,
      method: 'get_state',
      args: null,
    };
    
    const response = await executor.execute(request);
    
    expect(response.ok).toBe(true);
    expect(response.error).toBeUndefined();
    
    // Read-only commands must not bump the revision
    expect(executor.getRevision()).toBe(0);
  });
  
  it('should handle multiple concurrent-like updates sequentially', async () => {
    const addMirror = (requestId: string, expectedRevision: number) => executor.execute({
      protocolVersion: 1,
      requestId,
      expectedRevision,
      method: 'add',
      args: {
        kind: 'mirror',
        pose: {
          position: [0.1, 0.1, 0],
          orientation: [0, 0, 0, 1],
        },
        mount: {
          pivotPoint: [0, 0, 0],
          axes: {
            tiltX: { min: -0.1, max: 0.1 },
            tiltY: { min: -0.1, max: 0.1 },
            rotationZ: { min: 0, max: Math.PI },
          },
        },
        props: {},
        active: true,
      },
    });
    
    // First update
    await addMirror('update-1', 0);
    
    const revAfterFirst = executor.getRevision();
    expect(revAfterFirst).toBe(1);
    
    // Second update should use new revision
    const staleResponse = await addMirror('update-2-stale', 0);
    
    expect(staleResponse.error).toBe('STALE_REVISION');
    expect(staleResponse.ok).toBe(false);
    
    // Update with correct revision
    await addMirror('update-2-correct', revAfterFirst);
    
    expect(executor.getRevision()).toBe(2);
  });
});

describe('BB-03 | Add Command', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(() => {
    executor = new CommandExecutor();
  });
  
  it('should add element to scene', async () => {
    const uuidBefore = executor.getCurrentScene().elements.length;
    
    await executor.execute({
      protocolVersion: 1,
      requestId: 'add-source',
      expectedRevision: 0,
      method: 'add',
      args: {
        kind: 'source',
        pose: {
          position: [0, 0.1, 0],
          orientation: [0, 0, 0, 1],
        },
        mount: {
          pivotPoint: [0, 0, 0],
          axes: {
            tiltX: { min: -0.1, max: 0.1 },
            tiltY: { min: -0.1, max: 0.1 },
            rotationZ: { min: 0, max: Math.PI },
          },
        },
        props: {
          wavelength_nm: 532,
          forward_cm: 100,
          backward_cm: 0,
          polPreset: 'H',
        },
        active: true,
      },
    });
    
    const scene = executor.getCurrentScene();
    expect(scene.elements.length).toBe(uuidBefore + 1);
    expect(scene.revision).toBeGreaterThan(0);
  });
});

describe('BB-03 | Remove Command', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(async () => {
    executor = new CommandExecutor();
    
    // Add an element first
    await executor.execute({
      protocolVersion: 1,
      requestId: 'add-for-remove',
      expectedRevision: 0,
      method: 'add',
      args: {
        kind: 'mirror' as const,
        pose: {
          position: [0.2, 0.1, 0.05],
          orientation: [0, 0, 0, 1],
        },
        mount: {
          pivotPoint: [0, 0, 0],
          axes: {
            tiltX: { min: -0.1, max: 0.1 },
            tiltY: { min: -0.1, max: 0.1 },
            rotationZ: { min: 0, max: Math.PI },
          },
        },
        props: {},
        active: true,
      },
    });
  });
  
  it('should remove element by UUID', async () => {
    const scene = executor.getCurrentScene();
    const elementUuid = scene.elements[0].uuid;
    const countBefore = scene.elements.length;
    
    await executor.execute({
      protocolVersion: 1,
      requestId: 'remove-test',
      expectedRevision: scene.revision,
      method: 'remove',
      args: { uuid: elementUuid },
    });
    
    const updatedScene = executor.getCurrentScene();
    expect(updatedScene.elements.length).toBe(countBefore - 1);
  });
});

describe('BB-03 | SetPose Command', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(async () => {
    executor = new CommandExecutor();
    
    // Add an element first
    await executor.execute({
      protocolVersion: 1,
      requestId: 'add-for-pose',
      expectedRevision: 0,
      method: 'add',
      args: {
        kind: 'lens' as const,
        pose: {
          position: [0.1, 0.1, 0],
          orientation: [0, 0, 0, 1],
        },
        mount: {
          pivotPoint: [0, 0, 0],
          axes: {
            tiltX: { min: -0.1, max: 0.1 },
            tiltY: { min: -0.1, max: 0.1 },
            rotationZ: { min: 0, max: Math.PI },
          },
        },
        props: { focalLength_m: 0.05 },
        active: true,
      },
    });
  });
  
  it('should update element pose', async () => {
    const scene = executor.getCurrentScene();
    const elementUuid = scene.elements[0].uuid;
    
    await executor.execute({
      protocolVersion: 1,
      requestId: 'set-pose-test',
      expectedRevision: scene.revision,
      method: 'setPose',
      args: {
        uuid: elementUuid,
        pose: {
          position: [0.2, 0.2, 0.1],
          orientation: [0, 0, 0, 1],
        },
      },
    });
    
    const updatedScene = executor.getCurrentScene();
    expect(updatedScene.elements[0].pose.position).toEqual([0.2, 0.2, 0.1]);
  });
});

describe('BB-03 | Undo/Redo Support', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(() => {
    executor = new CommandExecutor();
  });
  
  it('should support undo and redo cycles', async () => {
    const initialElements = executor.getCurrentScene().elements.length;
    
    // Add element
    await executor.execute({
      protocolVersion: 1,
      requestId: 'add-undo',
      expectedRevision: 0,
      method: 'add',
      args: {
        kind: 'mirror' as const,
        pose: {
          position: [0.1, 0.1, 0],
          orientation: [0, 0, 0, 1],
        },
        mount: {
          pivotPoint: [0, 0, 0],
          axes: {
            tiltX: { min: -0.1, max: 0.1 },
            tiltY: { min: -0.1, max: 0.1 },
            rotationZ: { min: 0, max: Math.PI },
          },
        },
        props: {},
        active: true,
      },
    });
    
    // Should have 1 element now
    expect(executor.getCurrentScene().elements.length).toBeGreaterThanOrEqual(initialElements + 1);
    
    // Undo
    await executor.execute({
      protocolVersion: 1,
      requestId: 'undo-test',
      expectedRevision: executor.getRevision(),
      method: 'undo',
      args: null,
    });
    
    // Back to initial
    expect(executor.getCurrentScene().elements.length).toBe(initialElements);
    
    // Redo
    await executor.execute({
      protocolVersion: 1,
      requestId: 'redo-test',
      expectedRevision: executor.getRevision(),
      method: 'redo',
      args: null,
    });
    
    // Back again
    expect(executor.getCurrentScene().elements.length).toBeGreaterThanOrEqual(initialElements + 1);
  });
  
  it('should block undo at earliest entry', async () => {
    const response = await executor.execute({
      protocolVersion: 1,
      requestId: 'undo-at-start',
      expectedRevision: 0,
      method: 'undo',
      args: null,
    });
    
    expect(response.ok).toBe(false);
    expect(response.error).toBe('LIMIT');
  });
});

describe('BB-03 | Idempotency', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(() => {
    executor = new CommandExecutor();
  });
  
  it('should return cached response for duplicate requestId', async () => {
    const request: CommandRequest = {
      protocolVersion: 1,
      requestId: 'idempotent-test',
      expectedRevision: 0,
      method: 'get_state',
      args: null,
    };
    
    const firstResponse = await executor.execute(request);
    const secondResponse = await executor.execute(request);
    
    expect(firstResponse.requestId).toBe(secondResponse.requestId);
    expect(firstResponse.revision).toBe(secondResponse.revision);
    
    // Both should succeed
    expect(firstResponse.ok).toBe(true);
    expect(secondResponse.ok).toBe(true);
  });
});

describe('BB-03 | Validation Failures', () => {
  
  let executor: CommandExecutor;
  
  beforeEach(() => {
    executor = new CommandExecutor();
  });
  
  it('should reject invalid arguments gracefully', async () => {
    // Try to add element with missing required fields
    const response = await executor.execute({
      protocolVersion: 1,
      requestId: 'invalid-add',
      expectedRevision: 0,
      method: 'add',
      args: {
        kind: 'lens' as const,
        pose: {
          position: [NaN, 0, 0], // Invalid NaN value
          orientation: [0, 0, 0, 1],
        },
        mount: {
          pivotPoint: [0, 0, 0],
          axes: {
            tiltX: { min: -0.1, max: 0.1 },
            tiltY: { min: -0.1, max: 0.1 },
            rotationZ: { min: 0, max: Math.PI },
          },
        },
        props: { focalLength_m: 0.05 },
        active: true,
      },
    });
    
    expect(response.ok).toBe(false);
    expect(response.error).toBe('VALIDATION');
  });
});
