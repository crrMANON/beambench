export interface OpticalPreset {
  id: string;
  name: string;
  factory: 'polarizer' | 'waveplate' | 'faraday' | 'beamSplitter' | 'multimeter';
  params: Record<string, string | number | boolean>;
}

export interface OpticalLibrary {
  apiVersion: 1;
  id: string;
  name: string;
  version: string;
  presets: OpticalPreset[];
}

export const BASIC_TYPES = new Set(['source', 'raysSource', 'lens', 'thickLens', 'mirror', 'beamblock']);

export function presetCatalog(libraries: OpticalLibrary[]): Map<string, OpticalPreset> {
  const catalog = new Map<string, OpticalPreset>();
  for (const library of libraries) {
    for (const preset of library.presets) catalog.set(`${library.id}:${preset.id}`, preset);
  }
  return catalog;
}

/** Uses original CSS and drag handlers, without touching any scene or renderer. */
export function installPalette(
  palette: HTMLElement | null,
  profile: 'original' | 'basic',
  catalog: Map<string, OpticalPreset>,
): void {
  if (!palette) return;
  if (profile === 'basic') {
    palette.querySelectorAll<HTMLElement>('.pal-item').forEach((button) => {
      if (!BASIC_TYPES.has(button.dataset.type ?? '')) button.remove();
    });
  }
  const list = palette.querySelector('.pal-list');
  if (!list) return;
  for (const [id, preset] of catalog) {
    const button = palette.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'pal-item';
    button.draggable = true;
    button.dataset.type = id;
    button.textContent = preset.name;
    list.appendChild(button);
  }
}

/** Supply original factories; never import Three.js or change native object geometry. */
export function createPreset<T>(
  preset: OpticalPreset,
  factories: Record<OpticalPreset['factory'], (params: any) => T>,
): T {
  return factories[preset.factory]({ ...preset.params });
}

/** Preserve native waveplate parameters for both creation and SceneV1 restoration. */
export function waveplateParams(props: Record<string, unknown>) {
  const type = props.type === 'QWP' ? 'QWP' : 'HWP';
  return {
    type,
    delta: typeof props.delta === 'number' && Number.isFinite(props.delta)
      ? props.delta : type === 'QWP' ? Math.PI / 2 : Math.PI,
    axisDeg: Number(props.fastAxisAngleDeg ?? props.axisDeg) || 0,
  };
}
