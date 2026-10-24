// Explicit, checked build adapters keep the original vendor snapshot untouched.
// These transformations run ONLY for the separately requested detailed build.
export function transformDetailedSource(source, id) {
  const path = id.split('?')[0].replaceAll('\\', '/');
  let code = source;
  const replace = (from, to) => {
    const count = code.split(from).length - 1;
    if (count !== 1) throw new Error(`Detailed model adapter: expected one anchor in ${path}: ${from.slice(0, 90)} (found ${count})`);
    code = code.replace(from, to);
  };
  const imports = (names) => { code = `import { ${names} } from '/src/models/detailed.js';\n${code}`; };
  if (path.endsWith('/src/upstream/elements.js')) {
    imports('applyDetailedElement');
    // Preserve ball/picking positions; extend the shared shaft into the ball centre.
    replace('const rod = new THREE.Mesh( new THREE.CylinderGeometry(rodRad, rodRad, stalkLen, 16)',
      'const ugiReach = stalkLen + extraReach;\n  const rod = new THREE.Mesh( new THREE.CylinderGeometry(rodRad, rodRad, ugiReach, 16)');
    replace('rod.position.set(stalkLen/2, 0, zOff)', 'rod.position.set(ugiReach/2, 0, zOff)');
    replace('ball.position.set(stalkLen + extraReach, 0, zOff)', 'ball.position.set(ugiReach, 0, zOff)');
    const functions = ['makeLens', 'makeThickLens', 'makeMirror', 'makePolarizer', 'makeWaveplate',
      'makeFaraday', 'makeBeamSplitter', 'makeBeamBlock', 'makeGrating', 'makeMultimeter'];
    for (const name of functions) {
      replace(`export function ${name}(`, `function ${name}Legacy(`);
      code += `\nexport function ${name}(options) { return applyDetailedElement(${name}Legacy(options)); }\n`;
    }
    for (const name of ['refreshMirrorVisual', 'refreshThickLensVisual']) {
      replace(`export function ${name}(`, `function ${name}Legacy(`);
      code += `\nexport function ${name}(el) {
        const legacy = el?.mesh?.children.find(c => c.isGroup && !c.userData.isHardware && !c.userData.isDetailedModel && c.name !== 'UGI');
        const before = legacy?.children.map(c => c.geometry).filter(Boolean) ?? [];
        ${name}Legacy(el);
        const live = new Set(legacy?.children.map(c => c.geometry));
        for (const geometry of before) if (!live.has(geometry)) geometry.dispose();
        applyDetailedElement(el);
      }\n`;
    }
    replace('export function updateElementLabel(', 'function updateElementLabelLegacy(');
    code += '\nexport function updateElementLabel(el) { updateElementLabelLegacy(el); if (el.mesh.userData.bbDetailedReady) applyDetailedElement(el); }\n';
  } else if (path.endsWith('/src/upstream/hardware.js')) {
    imports('createDetailedHardware, decorateDetailedStand');
    replace('export function attachHardware(', 'function attachHardwareLegacy(');
    code += '\nexport function attachHardware(target, options) { return createDetailedHardware(target, options); }\n';
    replace('export function createStand()', 'function createStandLegacy()');
    code += '\nexport function createStand() { return decorateDetailedStand(createStandLegacy()); }\n';
  } else if (path.endsWith('/src/upstream/propagation.js')) {
    imports('detailedDetectorHit, prepareDetailedPropagation');
    replace('elementLastInfo.clear();', 'elementLastInfo.clear();\n  meterLastInfo.clear();\n  prepareDetailedPropagation(elements);');
    const begin = '      /* ---------- Multimeter (read-only; pass-through) ---------- */';
    const end = '      /* ---------- Lens (thin): symmetric 2D angular kick + q-update ---------- */';
    const a = code.indexOf(begin), b = code.indexOf(end);
    if (a < 0 || b <= a || code.indexOf(begin, a + 1) >= 0) throw new Error('Detailed detector propagation anchors changed');
    code = code.slice(0, a) + `      // Detailed opaque sensor: local -Z front receives, both sides absorb.
      if (el.type === 'multimeter') {
        const metrics = computeBeamMetrics(path);
        const accepted = detailedDetectorHit(el, path, metrics, beamReadout, meterLastInfo, {
          aoi_deg: aoi_deg_hit, incomingDir: incomingDir_hit, Irel: metrics.Irel,
          wavelength_nm: getPathLambda(path) * 1e9,
        });
        _meterUpdated = _meterUpdated || accepted;
        break;
      }
\n` + code.slice(b);
  } else if (path.endsWith('/src/physics/trace.ts')) {
    replace('const hitsAperture = offset <= aperture;', `const frontFacing = element.props.detectorMode !== 'front-absorbing' || dot(beam.direction, surfaceNormal(element)) > 1e-8;
        const hitsAperture = offset <= aperture && frontFacing;`);
    replace("truncationReason: hitsAperture ? undefined : 'OUTSIDE_APERTURE',", "truncationReason: hitsAperture ? undefined : frontFacing ? 'OUTSIDE_APERTURE' : 'BACK_FACE',");
    replace("if (!hitsAperture) {\n          recordLoss(ctx, segmentId, 'aperture_cut', position, beam.power);\n        }",
      "if (!hitsAperture) {\n          recordLoss(ctx, segmentId, frontFacing ? 'aperture_cut' : 'absorption', position, beam.power);\n        }");
  } else if (path.endsWith('/src/upstream/main.js')) {
    code += `\n// Detailed-build-only diagnostics; no UI or scene setup changes.
window.__beambench.modelProfile = 'detailed';
window.__beambench.modelAudit = () => {
  const result = [];
  const inspect = (root, type, props) => {
    const nodes = []; root.traverse(o => { if (o.userData?.isDetailedModel) nodes.push(o); });
    const bounds = new THREE.Box3().setFromObject(root);
    result.push({ type, props: { ...props }, detailedNodes: nodes.length,
      bounds: [bounds.min.toArray(), bounds.max.toArray()],
      surfaces: root.userData.element?._surfaceMeshes?.length ?? 0,
      roundHolder: !!root.children.find(c => c.userData.isDetailedModel && c.userData.hasThroughAperture),
    });
  };
  elements.forEach(el => inspect(el.mesh, el.type, el.props));
  Sources.sources.forEach(s => inspect(s.group, 'source', s.props));
  return result;
};
window.__beambench.renderStats = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
  geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
window.__beambench.focusModel = (type, view = 'front', distance = .035) => {
  const root = type === 'source' ? Sources.sources[0]?.group : elements.find(e => e.type === type)?.mesh;
  if (!root) return false;
  const target = root.getWorldPosition(new THREE.Vector3());
  const forward = type === 'source' ? 1 : -1;
  const offset = view === 'side' ? new THREE.Vector3(distance, distance * .12, 0) :
    new THREE.Vector3(distance * .12, distance * .12, (view === 'front' ? forward : -forward) * distance);
  camera.position.copy(target).add(offset); orbit.target.copy(target); camera.lookAt(target); orbit.update();
  return true;
};
window.__beambench.detectorReadings = () => elements.filter(e => e.type === 'multimeter')
  .map(e => ({ id: e.id, position: e.mesh.position.toArray(), reading: meterLastInfo.get(e.id) ?? null }));
`;
  }
  return code === source ? null : code;
}

export function detailedModelsPlugin(enabled) {
  return { name: 'beambench-detailed-models', enforce: 'pre',
    transform(source, id) {
      const code = enabled ? transformDetailedSource(source, id) : null;
      return code === null ? null : { code, map: null };
    } };
}
