import { describe, it, expect } from 'vitest';
// @ts-ignore - upstream module is plain JS
import { ZH_LABELS, translateLabel } from '../../src/upstream/i18n.js';

describe('Chinese GUI labels', () => {
  it('translates the main menu labels', () => {
    expect(translateLabel('Visualization')).toBe('显示设置');
    expect(translateLabel('Show Table')).toBe('显示光具台');
    expect(translateLabel('Training View')).toBe('训练视图');
    expect(translateLabel('Save State')).toBe('保存场景');
    expect(translateLabel('Mirror')).toBe('反射镜');
  });

  it('leaves unknown or already-Chinese labels untouched', () => {
    expect(translateLabel('Some Future Control')).toBe('Some Future Control');
    expect(translateLabel('显示设置')).toBe('显示设置');
    expect(translateLabel('')).toBe('');
  });

  it('covers lighting, element and source controls', () => {
    for (const key of [
      'Lighting', 'Ambient Light', 'Key Light', 'Fill Light',
      'Selected Element', 'Beam Model', 'Wavelength (nm)', 'Pol Preset',
    ]) {
      expect(ZH_LABELS[key]).toBeTruthy();
    }
  });
});
