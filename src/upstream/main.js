/*!
 * BeamBench Copyright (C) 2025 VisuPhy
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Local modifications through 2026-10-24: laboratory integration and data-only optics libraries.
 */

let commandExecutor = null;

// main.js — scene, GUI, multi-source Gaussian propagation with multimeter, gratings, PBS, unified mirror, dichroic, blocks, broadband sources
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js?v=1.0.15';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';

// Import local modules
import * as GizmoUI from './gizmo-ui.js?v=1.0.15';
import * as Ruler from './ruler.js?v=1.0.15';
import * as State from './state.js?v=1.0.15';
import * as Sources from './sources.js?v=1.0.15';
import {
  HOLE_PITCH_M,
  clampToTable,
  placementIssue,
  snapToHoleGrid,
} from '../interaction/placement';
import { attachHardware, createStand, updateStand, STAND_METRICS, MODEL_SCALE } from './hardware.js?v=1.0.15';
import { createLabEnvironment } from './environment.js?v=1.0.15';
import { localizeGui } from './i18n.js?v=1.0.15';
import { sceneFromUpstream } from '../integration/upstream-scene';
import { SceneMirror } from '../integration/scene-mirror';
import { UiCommandExecutor } from '../integration/ui-commands';
import { CaptureService } from '../render/capture';
import { HostBridge } from '../bridge/host-bridge';
import {
  clampToPlaneXZ,
  makeLens, makeThickLens, makeMirror, makeMultimeter,
  makePolarizer, makeWaveplate, makeFaraday,
  makeBeamSplitter, makeBeamBlock, makeGrating,
  updateElementLabel,
  refreshMirrorVisual, refreshThickLensVisual
} from './elements.js?v=1.0.15';
import * as pol from './polarization.js?v=1.0.15';
import * as Propagation from './propagation.js?v=1.0.15';
import { buildTransverseBasis } from './beam-frame.js?v=1.0.15';
import { presetCatalog, installPalette, createPreset, waveplateParams } from '../library/presets';

const opticalPresets = presetCatalog(__BB_OPTICS_LIBRARIES__);
installPalette(document.getElementById('palette'), __BB_LIBRARY_PROFILE__, opticalPresets);

const BUILD_STAMP = typeof __BB_BUILD__ === 'string' ? __BB_BUILD__ : 'dev';

/* ========= Scene ========= */
const app = document.getElementById('app');
let renderer;
try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
    window.__bbBootFail?.(
        '浏览器无法创建 WebGL 上下文',
        '请在浏览器设置中启用硬件加速/WebGL，或改用 Chrome / Edge 后重试。'
    );
    throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x2f3339, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2f3339);

// Environment reflections make glass and mirror surfaces read correctly.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.fog = new THREE.Fog(0x2f3339, 1.2, 4.5);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(0.06, 0.04, 0.08);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

/* ========= Camera views ========= */
const VIEW_PRESETS = {
    perspective: { pos: [0.06, 0.04, 0.08], target: [0, 0.03, 0] },
    bench: { pos: [0.32, 0.24, 0.38], target: [0, 0.02, 0.06] },
    front: { pos: [0, 0.08, 0.45], target: [0, 0.03, 0] },
};

/** World-space bounds of optical heads + their stands (labels excluded). */
function contentBounds() {
    const box = new THREE.Box3();
    const add = (root) => {
        root.updateWorldMatrix(true, true);
        root.traverse((part) => {
            if (!part.isMesh) return;
            if (part.userData?.isSelectionHandle || part.userData?.isContour) return;
            if (!part.geometry) return;
            part.geometry.computeBoundingBox?.();
            if (!part.geometry.boundingBox) return;
            const bounds = part.geometry.boundingBox.clone();
            bounds.applyMatrix4(part.matrixWorld);
            box.union(bounds);
        });
    };
    elements.forEach((el) => add(el.mesh));
    Sources.sources.forEach((src) => add(src.group));
    for (const stand of standRegistry.values()) add(stand);
    if (box.isEmpty()) {
        box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 0.1, 0.2));
    }
    return box;
}

/**
 * Side: perfectly horizontal camera, table edge is a line, fit all optics.
 * Top: same content direction as side, rotated 90° about the horizontal axis.
 */
function fitViewToContent(view) {
    const box = contentBounds();
    const center = box.getCenter(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const tanHalf = Math.tan(verticalFov / 2);
    const aspect = camera.aspect || innerWidth / innerHeight;
    const padding = 1.14;
    const slack = 0.006;
    const halfZ = ((box.max.z - box.min.z) / 2) * padding + slack;

    if (view === 'side') {
        camera.up.set(0, 1, 0);
        const aboveTable = Math.max(0.01, box.max.y - TABLE_TOP_Y) * padding + slack;
        // Pull the default side framing back by 30%.
        const distance = Math.max(
            halfZ / (tanHalf * aspect),
            aboveTable / tanHalf,
            0.08
        ) * 1.3;
        camera.position.set(center.x + distance, TABLE_TOP_Y, center.z);
        orbit.target.set(center.x, TABLE_TOP_Y, center.z);
    } else {
        // Camera above, up = -X. Screen right is -Z, the same direction the
        // side view uses, so the bench runs right-to-left in both views.
        camera.up.set(-1, 0, 0);
        const halfX = ((box.max.x - box.min.x) / 2) * padding + slack;
        // Keep the same 30% pulled-back framing as the side view.
        const distance = Math.max(
            halfZ / (tanHalf * aspect),
            halfX / tanHalf,
            0.1
        ) * 1.3;
        camera.position.set(center.x, TABLE_TOP_Y + distance, center.z);
        orbit.target.set(center.x, TABLE_TOP_Y, center.z);
    }
    camera.lookAt(orbit.target);
    orbit.update();
}

let activeView = 'perspective';

function setView(name) {
    activeView = name;
    if (name === 'side' || name === 'top') {
        fitViewToContent(name);
        return;
    }
    const preset = VIEW_PRESETS[name] || VIEW_PRESETS.perspective;
    camera.up.set(0, 1, 0);
    camera.position.set(...preset.pos);
    orbit.target.set(...preset.target);
    camera.lookAt(...preset.target);
    orbit.update();
}

orbit.addEventListener('start', () => { activeView = null; });

document.getElementById('views')?.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.getAttribute('data-view')));
});
document.getElementById('training-exit')?.addEventListener('click', () => applyTrainingMode(false));
document.getElementById('reset-camera')?.addEventListener('click', () => params.resetView());
['translate', 'rotate', 'scale'].forEach((mode) => {
    document.getElementById(`gizmo-btn-${mode}`)?.addEventListener('click', () => {
        requestAnimationFrame(() => syncRoleGizmoUI());
    });
});

/* ========= Transform Controls & Gizmo Mode UI ========= */
GizmoUI.setup({
    camera,
    domElement: renderer.domElement,
    scene,
    orbit,
    recomputeFn: doRecompute,
    pushHistoryFn: () => State.pushHistory(),
    refreshSelectedUIFn: refreshSelectedUI,
    applyDirectTransformFn: applyDirectFromUI
});
const tcontrols = GizmoUI.tcontrols.main;

// Optical table (breadboard), legs and lab floor.
const grid = createLabEnvironment({ width: 1.4, depth: 1.0 });
scene.add(grid);
const TABLE_TOP_Y = grid.userData.table.topY;

// Lighting: bright lab key + fill + overhead hemisphere.
const hemi = new THREE.HemisphereLight(0xffffff, 0x4a5058, 1.45);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.9);
dir.position.set(0.35, 0.65, 0.4);
scene.add(dir);
const fill = new THREE.DirectionalLight(0xe4edff, 0.7);
fill.position.set(-0.45, 0.35, -0.35);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.4);
rim.position.set(0, 0.3, -0.6);
scene.add(rim);

/* ========= Polarization Group ========= */
const polGroup = pol.createPolGroup(scene);

/* ========= App params ========= */
const params = {
    maxSegments: 60,
    beamWidthScale: 1,
    showPolarization: true,
    showGrid: true,
    showLabels: true,
    showContours: false,
    trainingView: false,
    snapToHoles: false,
    ambientIntensity: 1.45,
    keyIntensity: 1.9,
    fillIntensity: 0.7,
    labelFontSize: 1.0,
    resetView: () => setView('perspective')
};

const URL_PARAMS = new URLSearchParams(location.search);
if (URL_PARAMS.get('training') === '1') {
    params.showLabels = false;
    params.showContours = true;
    params.trainingView = true;
}

function contourColorFor(material) {
    const color = material?.color;
    if (!color) return 0x9ff7ff;
    const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    return luminance < 0.42 ? 0xbdf4ff : 0x0d1114;
}

/** Add or toggle high-contrast silhouette edges on optics and hardware. */
function setContours(visible) {
    params.showContours = visible;
    scene.traverse((object) => {
        if (!object.isMesh) return;
        if (!object.userData.isVisualOnly && !object.userData.isHardwareMesh) return;
        if (!object.userData.contour) {
            const edges = new THREE.EdgesGeometry(object.geometry, 32);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
                color: contourColorFor(object.material),
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
            }));
            line.userData.isContour = true;
            object.add(line);
            object.userData.contour = line;
        }
        object.userData.contour.visible = visible;
    });
}

function applyLabelVisibility() {
    elements.forEach((el) => {
        const label = el.mesh.children.find((child) => child.isSprite);
        if (label) label.visible = params.showLabels;
    });
}

/** Clean capture view: hide DOM chrome and selection gizmos. */
let preTrainingLabels = null;
let preTrainingContours = null;
let trainingToastTimer = null;

function applyTrainingMode(enabled) {
    params.trainingView = enabled;
    if (enabled) clearSelectionHandles();
    trainingViewController?.updateDisplay?.();
    document.body.classList.toggle('training-mode', enabled);

    const toast = document.getElementById('training-toast');
    if (enabled) {
        if (preTrainingLabels === null) {
            preTrainingLabels = params.showLabels;
            preTrainingContours = params.showContours;
        }
        params.showLabels = false;
        showLabelsController?.updateDisplay?.();
        applyLabelVisibility();
        setContours(true);
        tcontrols.detach();
        if (toast) {
            if (toast) toast.textContent = '训练视图已开启：按 H 或 Esc 退出';
            toast.classList.add('show');
            clearTimeout(trainingToastTimer);
            trainingToastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
        }
    } else {
        if (preTrainingLabels !== null) params.showLabels = preTrainingLabels;
        if (preTrainingContours !== null) params.showContours = preTrainingContours;
        preTrainingLabels = null;
        preTrainingContours = null;
        showLabelsController?.updateDisplay?.();
        applyLabelVisibility();
        setContours(params.showContours);
        if (toast) toast.classList.remove('show');
        updateSelectionHandles();
        syncRoleGizmoUI();
    }
}

// Track pointer for click-vs-drag selection
let _ptrDown = { x: 0, y: 0, active: false };
let _viewDragging = false;
const _dragPX_THRESH2 = 16;

/* ========= UI helpers ========= */
let _recomputePending = false;
let _recomputeCount = 0;
function doRecompute() {
    if (_recomputePending) return;
    _recomputePending = true;
    requestAnimationFrame(() => {
        _recomputePending = false;
        _recomputeCount++;
        // REFACTORED: Call the propagation module
        Propagation.recompute({
            sources: Sources.sources, elements, params,
            beamGroup, polGroup, tcontrols,
            ribbonMeshes, gratingLastInfo, meterLastInfo, elementLastInfo,
            addSource: Sources.addSource, removeSourceByGroup: Sources.removeSourceByGroup, syncSourceW0ZR: Sources.syncSourceW0ZR,
            clampToPlaneXZ, refreshAfterRecompute
        });
    });
}

let _uiRefreshTimer = null;
function refreshAfterRecompute() {
    if (activeView === 'side' || activeView === 'top') {
        fitViewToContent(activeView);
    }
    syncSceneMirror();
    if (!handleDrag) updateSelectionHandles();
    if (_uiRefreshTimer) clearTimeout(_uiRefreshTimer);
    _uiRefreshTimer = setTimeout(() => { _uiRefreshTimer = null; refreshSelectedUI(); }, 120);
}

function live(ctrl, handler) {
    ctrl.onChange(handler);
    ctrl.onFinishChange(v => { handler(v); refreshAfterRecompute(); State.pushHistory(); });
    return ctrl;
}

function clampMirrorSizeToR(mesh, R) {
  if (!mesh?.geometry?.parameters) return;
  const Ra = Math.abs(R);
  if (!Number.isFinite(Ra) || Ra <= 0) return;

  const baseW = mesh.geometry.parameters.width  || 0.004;
  const baseH = mesh.geometry.parameters.height || 0.004;
  const maxWorld = 2 * Ra;

  // convert to max scale on each axis
  const maxScaleX = Math.max(1e-6, maxWorld / baseW);
  const maxScaleY = Math.max(1e-6, maxWorld / baseH);

  const signX = Math.sign(mesh.scale.x) || 1;
  const signY = Math.sign(mesh.scale.y) || 1;

  const absX = Math.min(Math.abs(mesh.scale.x), maxScaleX);
  const absY = Math.min(Math.abs(mesh.scale.y), maxScaleY);

  mesh.scale.x = signX * absX;
  mesh.scale.y = signY * absY;
}

function clampThickLensSizeToR(mesh, R1, R2) {
  if (!mesh?.geometry?.parameters) return;

  const radii = [R1, R2]
    .map(r => Math.abs(Number(r)))
    .filter(r => Number.isFinite(r) && r > 1e-9);
  if (!radii.length) return;

  const minR = Math.min(...radii);
  const baseW = mesh.geometry.parameters.width || 0.004;
  const baseH = mesh.geometry.parameters.height || 0.004;

  const signX = Math.sign(mesh.scale.x) || 1;
  const signY = Math.sign(mesh.scale.y) || 1;
  const absX = Math.abs(mesh.scale.x);
  const absY = Math.abs(mesh.scale.y);

  const halfDiag = 0.5 * Math.hypot(baseW * absX, baseH * absY);
  if (!Number.isFinite(halfDiag) || halfDiag <= minR || halfDiag <= 0) return;

  const scaleFactor = minR / halfDiag;
  mesh.scale.x = signX * absX * scaleFactor;
  mesh.scale.y = signY * absY * scaleFactor;
}



/* ========= GUI ========= */
let outFolder = null;
const gui = new GUI({ title: "Controls", width: 360 });

const fileButtonContainer = document.createElement('div');
fileButtonContainer.style.cssText = 'display:flex; justify-content:space-around; gap:8px; padding:8px 4px; border-bottom:1px solid var(--widget-color)';
gui.domElement.querySelector('.title').after(fileButtonContainer);

const dummyGui = new GUI({ autoPlace: false });
const saveBtnCtrl = dummyGui.add({ save: State.saveState }, 'save').name("Save State");
const loadBtnCtrl = dummyGui.add({ load: State.loadState }, 'load').name("Load State");
saveBtnCtrl.domElement.querySelector('button').style.width = '100%';
loadBtnCtrl.domElement.querySelector('button').style.width = '100%';
fileButtonContainer.appendChild(saveBtnCtrl.domElement.querySelector('button'));
fileButtonContainer.appendChild(loadBtnCtrl.domElement.querySelector('button'));
dummyGui.destroy();

let beamWidthScaleController, showGridController, showLabelsController, labelFontSizeController;
let trainingViewController;
let snapToHolesController;

const fLight = gui.addFolder("Lighting");
fLight.add(params, 'ambientIntensity', 0, 5, 0.05).name('Ambient Light')
    .onChange((value) => { hemi.intensity = value; });
fLight.add(params, 'keyIntensity', 0, 6, 0.05).name('Key Light')
    .onChange((value) => { dir.intensity = value; });
fLight.add(params, 'fillIntensity', 0, 4, 0.05).name('Fill Light')
    .onChange((value) => { fill.intensity = value; });

const fViz = gui.addFolder("Visualization");
snapToHolesController = fViz.add(params, 'snapToHoles').name('吸附到孔位');
live(fViz.add(params, "maxSegments", 4, 200, 1).name("Max Interactions"), doRecompute);
beamWidthScaleController = live(fViz.add(params, "beamWidthScale", 0.01, 300, 0.01).name("Beam Width Scale"), doRecompute);
fViz.add(params, "showPolarization").name("Show Polarization").onChange(v => { pol.setVisible(polGroup, v); doRecompute(); });
showGridController = fViz.add(params, 'showGrid').name('Show Table').onChange(v => { grid.visible = v; });
showLabelsController = fViz.add(params, 'showLabels').name('Show Labels').onChange(() => {
    applyLabelVisibility();
});
fViz.add(params, 'showContours').name('Show Contours').onChange(v => setContours(v));
trainingViewController = fViz.add(params, 'trainingView').name('Training View')
    .onChange(v => applyTrainingMode(v));
labelFontSizeController = fViz.add(params, 'labelFontSize', 0.1, 5, 0.1).name('Label Font Size').onChange(v => {
    params.labelFontSize = v;
    elements.forEach(el => GizmoUI.correctLabelScale(el.mesh, params.labelFontSize));
});

// Localize lil-gui titles/buttons, including folders rebuilt on selection.
localizeGui(gui.domElement);
let localizePending = false;
const guiObserver = new MutationObserver(() => {
    if (localizePending) return;
    localizePending = true;
    requestAnimationFrame(() => {
        localizePending = false;
        localizeGui(gui.domElement);
    });
});
guiObserver.observe(gui.domElement, { childList: true, subtree: true, characterData: true });



/* ========= Drag & Drop Palette ========= */
const TABLE_BOUNDS = { width: 1.2, depth: 0.9 };
const BASE_RADIUS_M = 0.0135;
const BASE_CLEARANCE_M = 0.0015;

function existingBases() {
    const objects = new Set([
        ...elements.map((el) => el.mesh),
        ...Sources.sources.map((src) => src.group),
    ]);
    return [...objects].map((obj) => {
        const p = obj.getWorldPosition(new THREE.Vector3());
        return { position: { x: p.x, y: p.y, z: p.z }, radius: BASE_RADIUS_M };
    });
}

function screenToWorldOnXZ(clientX, clientY) {
    const rc = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    rc.setFromCamera({ x, y }, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    return rc.ray.intersectPlane(plane, hit) ? hit : new THREE.Vector3(0, 0, 0);
}

function spawnAt(type, pos) {
    pos = pos || new THREE.Vector3(0, 0, 0);
    const snapEnabled = !!params.snapToHoles;
    const snapped = snapEnabled
        ? snapToHoleGrid({ x: pos.x, y: pos.y, z: pos.z })
        : { x: pos.x, y: pos.y, z: pos.z };
    const bounded = clampToTable(snapped, TABLE_BOUNDS);
    pos = new THREE.Vector3(bounded.x, bounded.y, bounded.z);

    const issue = placementIssue(
        { x: pos.x, y: pos.y, z: pos.z },
        BASE_RADIUS_M,
        TABLE_BOUNDS,
        existingBases(),
        BASE_CLEARANCE_M
    );
    if (window.__beambench) {
        window.__beambench.lastPlacement = {
            type,
            position: { x: pos.x, y: pos.y, z: pos.z },
            issue,
            snapEnabled,
        };
    }
    if (issue) {
        console.warn(`[BeamBench] placement rejected: ${issue}`);
        return;
    }

    let newObject = null; // Store the mesh/group to select

    const preset = opticalPresets.get(type);
    if (preset) {
        const element = createPreset(preset, {
            polarizer: makePolarizer, waveplate: makeWaveplate, faraday: makeFaraday,
            beamSplitter: makeBeamSplitter, multimeter: makeMultimeter,
        });
        newObject = addElement(element, pos).mesh;
        _toggleSelection(newObject, false);
        return;
    }

    switch (type) {
        case 'source': 
            const src = Sources.addSource({ position: pos.clone(), yawRad: 0 }); 
            newObject = src.group;
            break;
        case 'raysSource':
            const raysSrc = Sources.addSource({ position: pos.clone(), yawRad: 0, mode: 'rays' });
            newObject = raysSrc.group;
            break;
        case 'lens': 
            newObject = addElement(makeLens({ f: 1.0 }), pos).mesh; 
            break;
        case 'thickLens':
            newObject = addElement(makeThickLens({ R1: 0.05, R2: -0.05, n: 1.5, thickness: 0.004 }), pos).mesh;
            break;
        case 'mirror': 
            newObject = addElement(makeMirror({ flat: true, R: 2.0, refl: 1.0 }), pos).mesh; 
            break;
        case 'polarizer': 
            newObject = addElement(makePolarizer({ axisDeg: 0 }), pos).mesh; 
            break;
        case 'waveplate': 
            newObject = addElement(makeWaveplate({ type: 'HWP', delta: Math.PI }), pos).mesh; 
            break;
        case 'faraday': 
            newObject = addElement(makeFaraday({ phiDeg: 45 }), pos).mesh; 
            break;
        case 'pbs': 
            newObject = addElement(makeBeamSplitter({ R: 0.5, polarizing: false, polTransmit: 'Vertical' }), pos).mesh; 
            break;
        case 'beamblock': 
            newObject = addElement(makeBeamBlock(), pos).mesh; 
            break;
        case 'grating':
            const el = makeGrating({ mode: 'reflective', d_um: 1.0, orders: 1 });
            el.props.visibleOrders = {};
            newObject = addElement(el, pos).mesh;
            break;
        case 'multimeter': 
            newObject = addElement(makeMultimeter(), pos).mesh; 
            break;
        case 'ruler':
            if (!Ruler.doesRulerExist()) {
                const rulerContext = { scene, selectable, tcontrols, pushHistory: State.pushHistory, isRestoringState: State.isRestoring() };
                const newRuler = Ruler.addRuler(rulerContext, pos);
                if (newRuler) {
                    // Rulers are special; select the endpoint to enable deletion
                    newObject = newRuler.points.p2;
                }
            }
            break;
    }

    // IMMEDIATELY SELECT THE NEW OBJECT
    // This ensures it is added to the 'selected' Set so Backspace/Delete works immediately.
    if (newObject) {
        _toggleSelection(newObject, false); // false = clear previous selection
    }
}

// --- Desktop Mouse Drag & Drop ---
document.getElementById('palette')?.querySelectorAll('.pal-item').forEach(btn => {
    btn.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', btn.getAttribute('data-type'));
        e.dataTransfer.effectAllowed = 'copy';
    });
});

renderer.domElement.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
renderer.domElement.addEventListener('drop', e => {
    e.preventDefault();
    const token = palettePointerDrag;
    if (token) {
        _cleanupPointerDrag(token);
        palettePointerDrag = null;
    }
    // Some automated/embedded browsers deliver an empty DataTransfer; fall back
    // to the pointer-drag token recorded on pointerdown.
    const type = e.dataTransfer.getData('text/plain') || token?.type || '';
    if (type) spawnAt(type, screenToWorldOnXZ(e.clientX, e.clientY));
});

document.addEventListener('dragend', () => {
    if (palettePointerDrag) {
        _cleanupPointerDrag(palettePointerDrag);
        palettePointerDrag = null;
    }
});

// --- Touch-based Drag & Drop ---
let touchDragActive = false;
let draggedItemType = null;
let dragGhost = null;
// Shared token consumes a drag exactly once, even if a browser emits both
// native HTML5 drop and pointerup for the same gesture.
let palettePointerDrag = null;

document.getElementById('palette')?.querySelectorAll('.pal-item').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        palettePointerDrag = {
            type: btn.getAttribute('data-type'),
            label: btn.textContent,
            ghost: null,
        };
    });
});

function _updatePointerGhost(drag, clientX, clientY) {
    if (!drag.ghost) {
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'drag-ghost';
        drag.ghost.textContent = drag.label;
        document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.left = `${clientX - drag.ghost.offsetWidth / 2}px`;
    drag.ghost.style.top = `${clientY - drag.ghost.offsetHeight / 2}px`;
}

function _cleanupPointerDrag(drag) {
    if (drag?.ghost) drag.ghost.remove();
}

window.addEventListener('pointermove', e => {
    if (!palettePointerDrag) return;
    _updatePointerGhost(palettePointerDrag, e.clientX, e.clientY);
});

window.addEventListener('pointerup', e => {
    const drag = palettePointerDrag;
    palettePointerDrag = null;
    if (!drag) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
    _cleanupPointerDrag(drag);
    if (inside && drag.type) {
        spawnAt(drag.type, screenToWorldOnXZ(e.clientX, e.clientY));
    }
});

document.getElementById('palette')?.querySelectorAll('.pal-item').forEach(btn => {
    btn.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        e.preventDefault();

        draggedItemType = btn.getAttribute('data-type');
        touchDragActive = true;

        dragGhost = document.createElement('div');
        dragGhost.className = 'drag-ghost';
        dragGhost.textContent = btn.textContent;
        document.body.appendChild(dragGhost);

        const touch = e.touches[0];
        dragGhost.style.left = `${touch.clientX - dragGhost.offsetWidth / 2}px`;
        dragGhost.style.top = `${touch.clientY - dragGhost.offsetHeight / 2}px`;

    }, { passive: false });
});

window.addEventListener('touchmove', e => {
    if (!touchDragActive || !dragGhost) return;
    e.preventDefault();

    if (e.touches.length > 0) {
        const touch = e.touches[0];
        dragGhost.style.left = `${touch.clientX - dragGhost.offsetWidth / 2}px`;
        dragGhost.style.top = `${touch.clientY - dragGhost.offsetHeight / 2}px`;
    }
}, { passive: false });

window.addEventListener('touchend', e => {
    if (!touchDragActive) return;

    if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const dropTarget = renderer.domElement;
        const rect = dropTarget.getBoundingClientRect();

        if (
            touch.clientX >= rect.left && touch.clientX <= rect.right &&
            touch.clientY >= rect.top && touch.clientY <= rect.bottom
        ) {
            if (draggedItemType) {
                spawnAt(draggedItemType, screenToWorldOnXZ(touch.clientX, touch.clientY));
            }
        }
    }

    if (dragGhost) {
        document.body.removeChild(dragGhost);
    }
    touchDragActive = false;
    draggedItemType = null;
    dragGhost = null;
});


/* ========= Elements & selection ========= */
const elements = [];
const selectable = [];
const ugiPickables = [];

// === Multi-selection state ===
const selected = new Set();          // THREE.Object3D selected (meshes or source groups)
const standRegistry = new Map();      // optical head Object3D -> base/post stand
let lastClicked = null;              // for focus when needed
const multiPivot = new THREE.Object3D(); // invisible gizmo pivot
scene.add(multiPivot);

const selectionHandles = new THREE.Group();
selectionHandles.name = 'bb-selection-handles';
scene.add(selectionHandles);
let selectionHandlePickables = [];
let selectedRole = 'optic';
let handleDrag = null;
let suppressSelectionClick = false;
let lastHandleHit = null;
let lastHandlePoint = null;

function isRulerPointObject(obj) {
    return !!obj?.userData?.isRulerPoint;
}

function applySelectionScale(obj, scaleVec) {
    if (!obj || !scaleVec) return;
    if (isRulerPointObject(obj)) {
        obj.scale.set(1, 1, 1);
        return;
    }
    obj.scale.set(scaleVec.x, scaleVec.y, MODEL_SCALE);
    GizmoUI.correctLabelScale(obj, params.labelFontSize);
}

function resetSelectionScale(obj) {
    if (!obj) return;
    if (isRulerPointObject(obj)) {
        obj.scale.set(1, 1, 1);
        return;
    }
    obj.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    GizmoUI.correctLabelScale(obj, params.labelFontSize);
}

// === Apply transforms from bottom HUD inputs to single or multi-selection ===
function applyDirectFromUI(op) {
    const gizObj = GizmoUI.tcontrols.main.object;
    if (!gizObj) return;

    const isMulti = (typeof selected !== 'undefined') && (selected.size > 1) && (gizObj === multiPivot);

    // Helper: decompose/move all selected by world-space delta
    const applyDeltaToSelection = (oldPivotWorld, newPivotWorld) => {
        const delta = new THREE.Matrix4().multiplyMatrices(newPivotWorld.clone(), oldPivotWorld.clone().invert());
        const tmp = new THREE.Matrix4(), local = new THREE.Matrix4();
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();

        for (const obj of selected) {
            const startWorld = obj.matrixWorld.clone();
            const newWorld = tmp.multiplyMatrices(delta, startWorld);
            const parentInv = obj.parent.matrixWorld.clone().invert();
            local.multiplyMatrices(parentInv, newWorld);
            local.decompose(pos, quat, scl);
            obj.position.copy(pos);
            obj.quaternion.copy(quat);
            applySelectionScale(obj, scl);
        }
        doRecompute();
        refreshAfterRecompute();
        State.pushHistory();
        refreshSelectedUI();
    };

    if (!isMulti) {
        // ---- Single selection: behave as before ----
        if (op.kind === 'translate') {
            if (selectedRole === 'base') {
                const next = clampToTable({
                    x: op.axis === 'x' ? op.value : gizObj.position.x,
                    y: 0,
                    z: op.axis === 'y' ? op.value : gizObj.position.z,
                }, TABLE_BOUNDS);
                gizObj.position.x = next.x;
                gizObj.position.z = next.z;
            } else if (op.axis === 'z') {
                const limits = heightLimits(gizObj);
                gizObj.position.y = Math.min(limits.max, Math.max(limits.min, op.value));
            }
        } else if (op.kind === 'rotate') {
            const e = new THREE.Euler().setFromQuaternion(gizObj.quaternion, 'YXZ');
            if (op.axis === 'yaw') e.y = THREE.MathUtils.degToRad(op.value);
            if (op.axis === 'tilt') e.x = THREE.MathUtils.degToRad(op.value);
            gizObj.setRotationFromEuler(e);
        } else if (op.kind === 'scale') {
            if (isRulerPointObject(gizObj)) {
                gizObj.scale.setScalar(1);
            } else {
                if (op.axis === 'x') gizObj.scale.x = op.value;
                if (op.axis === 'y') gizObj.scale.y = op.value;
                GizmoUI.correctLabelScale(gizObj, params.labelFontSize);
            }
        } else if (op.kind === 'scaleReset') {
            resetSelectionScale(gizObj);
        }

        if (op.kind === 'scale' || op.kind === 'scaleReset') {
            const tag = gizObj.userData?.element;
            if (tag?.type === 'mirror') {
                if (!tag.props.flat && Number.isFinite(tag.props.R)) {
                    clampMirrorSizeToR(gizObj, tag.props.R);
                }
                refreshMirrorVisual(tag);
            }
            if (tag?.type === 'thickLens') {
                clampThickLensSizeToR(gizObj, tag.props.R1, tag.props.R2);
                refreshThickLensVisual(tag);
            }
        }

        doRecompute();
        refreshAfterRecompute();
        State.pushHistory();
        syncStands();
        updateSelectionHandles();
        refreshSelectedUI();
        return;
    }

    // ---- Multi selection: pivot-delta math ----
    const oldPivotWorld = multiPivot.matrixWorld.clone();

    if (op.kind === 'translate') {
        multiPivot.position[op.axis] = op.value;
    } else if (op.kind === 'rotate') {
        const e = new THREE.Euler().setFromQuaternion(multiPivot.quaternion, 'YXZ');
        if (op.axis === 'yaw') e.y = THREE.MathUtils.degToRad(op.value);
        if (op.axis === 'tilt') e.x = THREE.MathUtils.degToRad(op.value);
        multiPivot.setRotationFromEuler(e);
    } else if (op.kind === 'scale') {
        if (op.axis === 'x') multiPivot.scale.x = op.value;
        if (op.axis === 'y') multiPivot.scale.y = op.value;
    } else if (op.kind === 'scaleReset') {
        multiPivot.scale.set(2,2,2);
    }

    multiPivot.updateMatrixWorld(true);
    const newPivotWorld = multiPivot.matrixWorld.clone();
    applyDeltaToSelection(oldPivotWorld, newPivotWorld);
}

// Utility: pick main target from a raycast hit
function _hitTarget(obj) {
  return obj.userData.attachTarget || obj;
}

function _hitRole(obj) {
  let current = obj;
  while (current) {
    if (current.userData?.hardwareRole) return current.userData.hardwareRole;
    current = current.parent;
  }
  return 'optic';
}

function clearSelectionHandles() {
  selectionHandlePickables = [];
  while (selectionHandles.children.length) {
    const child = selectionHandles.children[selectionHandles.children.length - 1];
    selectionHandles.remove(child);
    child.traverse?.((part) => {
      if (part.geometry && part.userData?.isSelectionHandle) part.geometry.dispose?.();
    });
  }
}

function _addHandleMesh(group, mesh, role, target) {
  mesh.userData.isSelectionHandle = true;
  mesh.userData.handleRole = role;
  mesh.userData.attachTarget = target;
  group.add(mesh);
  selectionHandlePickables.push(mesh);
  return mesh;
}

function _buildHeightArrow(target, worldPosition, direction, color, role) {
  const group = new THREE.Group();
  group.position.copy(worldPosition);
  const material = new THREE.MeshBasicMaterial({ color, depthTest: true });
  const stemHeight = 0.010;
  const stemCenter = direction > 0 ? stemHeight / 2 : -stemHeight / 2;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, stemHeight, 8), material);
  stem.position.y = stemCenter;
  _addHandleMesh(group, stem, role, target);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.0026, 0.0055, 12), material);
  cone.position.y = direction > 0 ? stemHeight + 0.0027 : -stemHeight - 0.0027;
  if (direction < 0) cone.rotation.x = Math.PI;
  _addHandleMesh(group, cone, role, target);
  selectionHandles.add(group);
  return group;
}

function currentGizmoMode() {
  if (document.getElementById('gizmo-btn-rotate')?.classList.contains('active')) return 'rotate';
  if (document.getElementById('gizmo-btn-scale')?.classList.contains('active')) return 'scale';
  return 'translate';
}

/**
 * Bottom bar adapts to the selected role:
 * - base: translate mode with X/Y inputs (world X/Z), no rotate/scale
 * - head/post: translate mode with Z height input, rotate available
 * - multi: original translate/rotate/scale
 */
function syncRoleGizmoUI() {
  const single = selected.size === 1;
  const role = selectedRole;
  const rotateBtn = document.getElementById('gizmo-btn-rotate');
  const scaleBtn = document.getElementById('gizmo-btn-scale');
  if (rotateBtn) rotateBtn.style.display = single && role === 'base' ? 'none' : '';
  if (scaleBtn) scaleBtn.style.display = single ? 'none' : '';

  if (single && role === 'base' && currentGizmoMode() !== 'translate') {
    GizmoUI.setGizmoMode('translate');
  }
  if (single && role !== 'base' && currentGizmoMode() === 'scale') {
    GizmoUI.setGizmoMode('translate');
  }

  const mode = currentGizmoMode();
  if (single) {
    GizmoUI.tcontrols.main.visible = false;
    GizmoUI.tcontrols.main.enabled = false;
    GizmoUI.tcontrols.scale.visible = false;
    GizmoUI.tcontrols.scale.enabled = false;
    if (mode !== 'rotate') {
      GizmoUI.tcontrols.yaw.visible = false;
      GizmoUI.tcontrols.yaw.enabled = false;
      GizmoUI.tcontrols.tilt.visible = false;
      GizmoUI.tcontrols.tilt.enabled = false;
    }
  } else if (!params.trainingView) {
    GizmoUI.updateGizmoState();
  }

  const xGroup = document.getElementById('gizmo-pos-x')?.closest('.gizmo-input-group');
  const yGroup = document.getElementById('gizmo-pos-y')?.closest('.gizmo-input-group');
  const zGroup = document.getElementById('gizmo-pos-z')?.closest('.gizmo-input-group');
  const selectedObject = selected.size === 1 ? [...selected][0] : null;
  if (single && selectedObject) {
    if (role === 'base') {
      if (xGroup) xGroup.style.display = '';
      if (yGroup) yGroup.style.display = '';
      if (zGroup) zGroup.style.display = 'none';
      document.getElementById('gizmo-pos-x').value = (selectedObject.position.x * 1000).toFixed(1);
      document.getElementById('gizmo-pos-y').value = (selectedObject.position.z * 1000).toFixed(1);
    } else {
      if (xGroup) xGroup.style.display = 'none';
      if (yGroup) yGroup.style.display = 'none';
      if (zGroup) zGroup.style.display = '';
      document.getElementById('gizmo-pos-z').value = (selectedObject.position.y * 1000).toFixed(1);
    }
  } else {
    if (xGroup) xGroup.style.display = '';
    if (yGroup) yGroup.style.display = '';
    if (zGroup) zGroup.style.display = '';
  }

  updateSelectionHandles();
}

function updateSelectionHandles() {
  clearSelectionHandles();
  if (params.trainingView) return;
  if (selected.size !== 1) return;
  if (currentGizmoMode() !== 'translate') return;
  const target = [...selected][0];
  if (!target) return;
  syncStands();
  const world = target.getWorldPosition(new THREE.Vector3());

  if (selectedRole === 'base') {
    const stand = standRegistry.get(target);
    if (!stand) return;
    const baseWorld = stand.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.042, 0.042),
      new THREE.MeshBasicMaterial({
        color: 0x35ff8a, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(baseWorld.x, TABLE_TOP_Y + STAND_METRICS.baseHeight + 0.002, baseWorld.z);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(plane.geometry),
      new THREE.LineBasicMaterial({ color: 0x0b3d24 })
    );
    plane.add(outline);
    _addHandleMesh(selectionHandles, plane, 'xy', target);
    return;
  }

  const scale = target.getWorldScale(new THREE.Vector3());
  const width = target.geometry?.parameters?.width ?? 0.0036;
  const offset = Math.max(0.014, width * Math.abs(scale.x) / 2 + 0.010);
  _buildHeightArrow(target, new THREE.Vector3(world.x + offset, world.y, world.z), 1, 0xff4d4d, 'yUp');
  _buildHeightArrow(target, new THREE.Vector3(world.x - offset, world.y, world.z), -1, 0x3fa9ff, 'yDown');
}

/** Collision meshes, source handles and mount hardware, without duplicates. */
function _collectPickables() {
    const pickables = [...selectable];
    for (const el of elements) {
        el.mesh?.traverse?.((part) => {
            if (part.userData?.isHardwareMesh) pickables.push(part);
        });
    }
    for (const src of Sources.sources) {
        src.group?.traverse?.((part) => {
            if (part.userData?.isHardwareMesh) pickables.push(part);
        });
    }
    for (const stand of standRegistry.values()) {
        stand.traverse((part) => {
            if (part.userData?.isHardwareMesh) pickables.push(part);
        });
    }
    pickables.push(...selectionHandlePickables);
    return pickables;
}

// Utility: attach gizmo to either single object or the multi pivot
function _attachGizmoForSelection() {
  if (selected.size === 0) { tcontrols.detach(); syncRoleGizmoUI(); return; }
  if (selected.size === 1) {
    const only = [...selected][0];
    // Keep the bottom bar attached; role UI replaces the 3D translate gizmo.
    tcontrols.attach(only);
    syncRoleGizmoUI();
    return;
  }
  // Place pivot at centroid of selection (world space)
  const pts = [...selected].map(o => o.getWorldPosition(new THREE.Vector3()));
  const c = pts.reduce((a,b)=>a.add(b), new THREE.Vector3()).multiplyScalar(1/pts.length);
  multiPivot.position.copy(c);
  multiPivot.quaternion.identity();
  multiPivot.scale.set(1,1,1);
  tcontrols.attach(multiPivot);
  syncRoleGizmoUI();
}

// Utility: toggle selection of an object, respecting sources vs elements
function _toggleSelection(obj, additive, role = 'optic') {
  if (!additive) selected.clear();
  if (obj) {
    if (selected.has(obj) && additive) selected.delete(obj);
    else selected.add(obj);
    lastClicked = obj;
    if (selected.size > 0) selectedRole = selected.size > 1 ? 'multi' : role;
  }
  _attachGizmoForSelection();
  refreshSelectedUI();
}

// Utility: clear selection
function _clearSelection() {
  selected.clear();
  selectedRole = 'optic';
  tcontrols.detach();
  clearSelectionHandles();
  syncRoleGizmoUI();
  refreshSelectedUI();
}

// Expose a small helper for UI (count/type)
function getSelectionInfo() {
  const size = selected.size;
  if (size <= 1) {
    const o = [...selected][0];
    const tag = o?.userData?.element;
    return { size, label: tag?.type ?? "--" };
  }
  return { size, label: `${size} objects` };
}

// Initialize Sources module
Sources.init({ scene, selectable, tcontrols, doRecompute, refreshAfterRecompute, State });

function headBottomLocal(obj) {
    const hardware = obj.children.find((child) => child.userData?.isHardware &&
        typeof child.userData.headBottomLocal === 'number');
    return (hardware?.userData.headBottomLocal ?? -0.004) * Math.abs(obj.scale.y || 1);
}

function heightLimits(obj) {
    const offset = headBottomLocal(obj);
    const collarTopWorld = TABLE_TOP_Y + STAND_METRICS.collarTop;
    return {
        min: collarTopWorld + STAND_METRICS.minPost - offset,
        max: collarTopWorld + STAND_METRICS.maxPost - offset,
    };
}

/** Create/update base+post stands so every base stays on the table. */
function syncStands() {
    const active = new Set();
    const update = (obj) => {
        active.add(obj);
        let stand = standRegistry.get(obj);
        if (!stand) {
            stand = createStand();
            stand.userData.isStand = true;
            scene.add(stand);
            standRegistry.set(obj, stand);
        }
        const world = obj.getWorldPosition(new THREE.Vector3());
        const quaternion = obj.getWorldQuaternion(new THREE.Quaternion());
        const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
        const headBottom = world.y + headBottomLocal(obj);
        updateStand(stand, {
            x: world.x,
            z: world.z,
            yaw: euler.y,
            headBottom,
            tableTop: TABLE_TOP_Y,
        });
        stand.traverse((part) => {
            if (part.userData?.isHardwareMesh) part.userData.attachTarget = obj;
        });
    };

    elements.forEach((el) => update(el.mesh));
    Sources.sources.forEach((src) => update(src.group));

    for (const [obj, stand] of [...standRegistry.entries()]) {
        if (!active.has(obj)) {
            scene.remove(stand);
            standRegistry.delete(obj);
        }
    }
}

function addElement(el, pos) {
    elements.push(el);
    selectable.push(el.mesh);
    scene.add(el.mesh);
    el.mesh.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    if (pos) {
        el.mesh.position.copy(pos);
        // clampToPlaneXZ(el.mesh); // allow y-positioning
    } else if (el.mesh.position.lengthSq() === 0) {
        const k = elements.length;
        el.mesh.position.set((k % 3 - 1) * 0.006, 0, -0.01 + 0.009 * k);
    }
    if (el.type === 'thickLens') {
        clampThickLensSizeToR(el.mesh, el.props.R1, el.props.R2);
        refreshThickLensVisual(el);
    }
    tcontrols.attach(el.mesh);
    if (el.ugi?.handle) { ugiPickables.push(el.ugi.handle); }

    if (el.props && typeof el.props.__bbUuid !== 'string') {
        el.props.__bbUuid = crypto.randomUUID();
    }

    if (el.mesh && !el.mesh.userData.hardwareAttached) {
        const geometry = el.mesh.geometry?.parameters ?? {};
        attachHardware(el.mesh, {
            kind: el.type,
            width: geometry.width ?? 0.0036,
            height: geometry.height ?? 0.0036,
            attachTarget: el.mesh,
        });
        el.mesh.userData.hardwareAttached = true;
        if (params.showContours) setContours(true);
    }

    GizmoUI.correctLabelScale(el.mesh, params.labelFontSize);

    doRecompute();
    refreshAfterRecompute();
    if (!State.isRestoring()) State.pushHistory();

    return el;
}

// Raycast selection
let _ugiActive = false;
let _ugiDrag = null;

function _raycasterFromEvent(e) {
    const rc = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    rc.setFromCamera({ x, y }, camera);
    return rc;
}

function _computeAngleDeg(el, worldPoint) {
    const pLocal = el.mesh.worldToLocal(worldPoint.clone());
    return THREE.MathUtils.radToDeg(Math.atan2(pLocal.y, pLocal.x));
}

function _updateUGIAngleFromEvent(e) {
    if (!_ugiActive || !_ugiDrag) return;
    const rc = _raycasterFromEvent(e);
    const hitPoint = new THREE.Vector3();
    if (!rc.ray.intersectPlane(_ugiDrag.plane, hitPoint)) return;
    const deg = _computeAngleDeg(_ugiDrag.el, hitPoint);
    _ugiDrag.el.props.axisDeg = deg;
    _ugiDrag.el.ugi?.setAngle?.(deg);
    doRecompute();
}

renderer.domElement.addEventListener('pointerdown', e => {
    const hits = _raycasterFromEvent(e).intersectObjects(ugiPickables, true);
    if (hits.length) {
        const el = hits[0].object?.userData?.element;
        if (el?.mesh) {
            const q = el.mesh.getWorldQuaternion(new THREE.Quaternion());
            const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
            const c = el.mesh.getWorldPosition(new THREE.Vector3());
            _ugiDrag = { el, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, c) };
            _ugiActive = true;
            orbit.enabled = false;
            _updateUGIAngleFromEvent(e);
            e.preventDefault(); e.stopPropagation();
        }
    }
}, { capture: true });

window.addEventListener('pointermove', e => { if (_ugiActive) { _updateUGIAngleFromEvent(e); e.preventDefault(); } }, { capture: true });
window.addEventListener('pointerup', e => {
    if (_ugiActive) {
        _ugiActive = false; _ugiDrag = null; orbit.enabled = true;
        refreshAfterRecompute(); State.pushHistory();
        e.preventDefault(); e.stopPropagation();
    }
}, { capture: true });

renderer.domElement.addEventListener('pointerdown', e => {
    _ptrDown.x = e.clientX; _ptrDown.y = e.clientY; _ptrDown.active = true; _viewDragging = false;
});
renderer.domElement.addEventListener('pointermove', e => {
    if (!_ptrDown.active) return;
    const dx = e.clientX - _ptrDown.x, dy = e.clientY - _ptrDown.y;
    if ((dx * dx + dy * dy) > _dragPX_THRESH2) _viewDragging = true;
});
renderer.domElement.addEventListener('pointerup', e => {
  const wasDragging = _viewDragging; _ptrDown.active = false; _viewDragging = false;
  if (handleDrag) return;
  if (suppressSelectionClick) { suppressSelectionClick = false; return; }
  if (GizmoUI.isGizmoPointerDown() || _ugiActive || wasDragging) { setTimeout(refreshSelectedUI, 0); return; }

  const hits = _raycasterFromEvent(e).intersectObjects(_collectPickables(), false);
  const additive = e.ctrlKey || e.metaKey;  // Ctrl on Win/Linux, ⌘ on macOS
  if (hits.length) {
    const target = _hitTarget(hits[0].object);
    _toggleSelection(target, additive, _hitRole(hits[0].object));
  } else {
    if (additive) { /* keep current selection */ }
    else _clearSelection();
  }
  setTimeout(refreshSelectedUI, 0);
});

// --- Role handles: green XY square (base) and red/blue height arrows (head) ---
renderer.domElement.addEventListener('pointerdown', e => {
    if (!selectionHandlePickables.length) return;
    const hits = _raycasterFromEvent(e).intersectObjects(_collectPickables(), false);
    const handleHit = hits.find((hit) => hit.object.userData?.isSelectionHandle);
    if (!handleHit) return;
    const handle = handleHit.object;
    const target = handle.userData.attachTarget;
    if (!target) return;

    // A handle may sit slightly behind the stand it belongs to. Allow that
    // only for the base XY plate, and never steal clicks from the optical head.
    if (handleHit !== hits[0]) {
        const first = hits[0];
        const firstRole = _hitRole(first.object);
        const sameTarget = _hitTarget(first.object) === target;
        if (!(handle.userData.handleRole === 'xy' && sameTarget &&
              (firstRole === 'base' || firstRole === 'post'))) {
            return;
        }
    }
    lastHandleHit = handle.userData.handleRole;
    handleDrag = {
        target,
        role: handle.userData.handleRole,
        startX: e.clientX,
        startY: e.clientY,
        startPosition: target.position.clone(),
        startPlane: null,
    };
    if (handleDrag.role === 'xy') {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_TOP_Y);
        const point = new THREE.Vector3();
        if (_raycasterFromEvent(e).ray.intersectPlane(plane, point)) {
            handleDrag.startPlane = point;
        }
    }
    orbit.enabled = false;
    e.preventDefault();
    e.stopImmediatePropagation();
}, { capture: true });

window.addEventListener('pointermove', e => {
    if (!handleDrag) return;
    const { target, role, startX, startY, startPosition, startPlane } = handleDrag;

    if (role === 'xy') {
        if (!startPlane) return;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_TOP_Y);
        const point = new THREE.Vector3();
        if (!_raycasterFromEvent(e).ray.intersectPlane(plane, point)) return;
        // Move by the pointer delta, not the absolute intersection (the handle
        // floats above the table, so absolute hits have parallax).
        let x = startPosition.x + (point.x - startPlane.x);
        let z = startPosition.z + (point.z - startPlane.z);
        const bounded = clampToTable({ x, y: 0, z }, TABLE_BOUNDS);
        x = bounded.x;
        z = bounded.z;
        if (params.snapToHoles) {
            const snapped = snapToHoleGrid({ x, y: 0, z });
            x = snapped.x;
            z = snapped.z;
        }
        lastHandlePoint = { raw: [point.x, point.y, point.z], bounded: [x, 0, z], client: [e.clientX, e.clientY] };
        target.position.x = x;
        target.position.z = z;
    } else {
        const deltaPx = e.clientY - startY;
        const limits = heightLimits(target);
        target.position.y = Math.min(
            limits.max,
            Math.max(limits.min, startPosition.y - deltaPx * 0.00018)
        );
    }

    syncStands();
    doRecompute();
    e.preventDefault();
}, { capture: true });

window.addEventListener('pointerup', e => {
    if (!handleDrag) return;
    suppressSelectionClick = true;
    handleDrag = null;
    orbit.enabled = true;
    doRecompute();
    refreshAfterRecompute();
    State.pushHistory();
    syncStands();
    updateSelectionHandles();
    e.preventDefault();
}, { capture: true });

// === Multi-transform application ===
// On gizmo drag, compute delta from start and apply to every selected object
let _multiStart = null;

function _captureStartState(ctrl) {
  if (selected.size <= 1) { _multiStart = null; return; }
  // Capture starting world matrices
  _multiStart = {
    gizmoStart: ctrl.object.matrixWorld.clone(),
    entries: [...selected].map(o => ({
      obj: o,
      parent: o.parent,
      worldStart: o.matrixWorld.clone()
    }))
  };
}

function _applyDelta(ctrl) {
  if (!_multiStart || selected.size <= 1) return;

  // Delta = currentGizmo * inverse(startGizmo)
  const gizmoNow = ctrl.object.matrixWorld.clone();
  const gizmoInv = _multiStart.gizmoStart.clone().invert();
  const delta = gizmoNow.multiply(gizmoInv); // world-space delta

  const tmp = new THREE.Matrix4(), local = new THREE.Matrix4();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();

    for (const ent of _multiStart.entries) {
    // newWorld = delta * startWorld
    const newWorld = tmp.multiplyMatrices(delta, ent.worldStart);
    // Convert world matrix to local under current parent
    const parentInv = ent.parent.matrixWorld.clone().invert();
    local.multiplyMatrices(parentInv, newWorld);
    local.decompose(pos, quat, scl);
    ent.obj.position.copy(pos);
    ent.obj.quaternion.copy(quat);
    if (ctrl.mode === 'scale') {
      applySelectionScale(ent.obj, scl);
    } else {
      ent.obj.scale.copy(scl);
    }
  }
  // Keep recomputation/UI in sync
  refreshSelectedUI();
  doRecompute();
  refreshAfterRecompute();
}

Object.values(GizmoUI.tcontrols).forEach(ctrl => {
  ctrl.addEventListener('mouseDown', () => {
    _captureStartState(ctrl);
    refreshSelectedUI(); // (existing)
  });

  ctrl.addEventListener('change', () => {
  if (!ctrl.object) return;
  if (ctrl.object) {

      if (selected.size > 1 && ctrl.object === multiPivot) {

        _applyDelta(ctrl);

      } else {

        // (existing single-object behavior)

        if (ctrl.object.userData?.isRulerPoint) {
          ctrl.object.scale.set(1, 1, 1);

          Ruler.updateRuler();

        } else {

          // clampToPlaneXZ(ctrl.object); // allow y-movement

          if (ctrl.mode === 'scale') {

            ctrl.object.scale.z = MODEL_SCALE;

            GizmoUI.correctLabelScale(ctrl.object, params.labelFontSize);

          }}}}
  if (ctrl.mode === 'scale') {
    applySelectionScale(ctrl.object, ctrl.object.scale);

    const tag = ctrl.object.userData?.element;
    if (tag?.type === 'mirror') {
      if (!tag.props.flat && Number.isFinite(tag.props.R)) {
        clampMirrorSizeToR(ctrl.object, tag.props.R);
      }
      // rebuild from *current* world size every time we scale
      refreshMirrorVisual(tag);
    }
    if (tag?.type === 'thickLens') {
      clampThickLensSizeToR(ctrl.object, tag.props.R1, tag.props.R2);
      refreshThickLensVisual(tag);
    }
  }
  refreshSelectedUI();
  doRecompute();
  refreshAfterRecompute();
});


  ctrl.addEventListener('mouseUp', () => {
    // Coarse placement snap: only for a single object directly on the table.
    if (selected.size === 1) {
      const obj = [...selected][0];
      if (obj?.parent === scene && !obj.userData?.isRulerPoint) {
        const raw = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
        const snapped = params.snapToHoles ? snapToHoleGrid(raw, HOLE_PITCH_M) : raw;
        const bounded = clampToTable(snapped, TABLE_BOUNDS);
        obj.position.set(bounded.x, bounded.y, bounded.z);
      }
    }
    if (ctrl.object?.userData?.isRulerPoint) Ruler.updateRuler();
    refreshSelectedUI();
    refreshAfterRecompute();
    State.pushHistory();
    _multiStart = null;
  });
});


window.addEventListener('keydown', e => {
  if (e.target.tagName.toLowerCase() === 'input') return;

  if (e.key.toLowerCase() === 'h') {
    applyTrainingMode(!params.trainingView);
  }
  if (e.key === 'Escape' && params.trainingView) {
    applyTrainingMode(false);
  }

  if ((e.key === 'Delete' || e.key === 'Backspace')) {
    deleteSelectedElements();
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? State.redo() : State.undo(); }
  }
});


function deleteSelectedElements() {
  if (selected.size === 0) return;

  for (const obj of [...selected]) {
    if (obj.userData?.isRulerPoint) {
      const rulerContext = { scene, selectable, tcontrols, pushHistory: State.pushHistory, isRestoringState: State.isRestoring() };
      Ruler.removeRuler(rulerContext);
      continue;
    }
    if (obj.userData?.element?.type === 'source') {
      Sources.removeSourceByGroup(obj);
    } else {
      const i = elements.findIndex(el => el.mesh === obj);
      if (i >= 0) {
        scene.remove(obj);
        const si = selectable.indexOf(obj); if (si >= 0) selectable.splice(si, 1);
        const uh = elements[i]?.ugi?.handle;
        if (uh) { const ui = ugiPickables.indexOf(uh); if (ui >= 0) ugiPickables.splice(ui, 1); }
        elements.splice(i, 1);
      }
    }
  }
  selected.clear();
  tcontrols.detach();
  doRecompute();
  refreshAfterRecompute();
  State.pushHistory();
}


function duplicateSelectedElements() {
  if (selected.size === 0) return;
  const offset = new THREE.Vector3(0.01, 0, 0.005);
  const newSelection = [];

  for (const obj of selected) {
    const tag = obj.userData?.element;
    if (!tag) continue;

    if (tag.type === 'source') {
      const src = Sources.sources.find(s => s.group === obj);
      if (src) {
        const newPosition = src.group.position.clone().add(offset);
        const newSource = Sources.addSource({ position: newPosition, yawRad: src.group.rotation.y });
        Object.assign(newSource.props, JSON.parse(JSON.stringify(src.props)));
        Sources.syncSourceW0ZR(newSource);
        newSource.group.scale.copy(src.group.scale);
        newSelection.push(newSource.group);
      }
    } else {
      const el = elements.find(e => e.mesh === obj);
      if (!el) continue;
      let maker = null;
      switch (el.type) {
        case 'lens': maker = makeLens; break;
        case 'thickLens': maker = makeThickLens; break;
        case 'mirror': maker = makeMirror; break;
        case 'polarizer': maker = makePolarizer; break;
        case 'waveplate': maker = makeWaveplate; break;
        case 'faraday': maker = makeFaraday; break;
        case 'beamSplitter': maker = makeBeamSplitter; break;
        case 'beamBlock': maker = makeBeamBlock; break;
        case 'grating': maker = makeGrating; break;
        case 'multimeter': maker = makeMultimeter; break;
      }
      if (maker) {
        const newProps = JSON.parse(JSON.stringify(el.props));
        const newEl = maker(newProps);
        addElement(newEl, el.mesh.position.clone().add(offset));
        newEl.mesh.quaternion.copy(el.mesh.quaternion);
        newEl.mesh.scale.copy(el.mesh.scale);
        if (newEl.type === 'mirror') refreshMirrorVisual(newEl);
        if (newEl.type === 'thickLens') refreshThickLensVisual(newEl);
        GizmoUI.correctLabelScale(newEl.mesh, params.labelFontSize);
        newSelection.push(newEl.mesh);
      }
    }
  }

  // Replace selection with the new copies and attach gizmo
  selected.clear();
  for (const o of newSelection) selected.add(o);
  _attachGizmoForSelection();
  doRecompute();
  refreshAfterRecompute();
  State.pushHistory();
}


function centerSelectedElementToBeam() {
  if (selected.size === 0) return;
  let any = false;
  for (const selObj of selected) {
    const tag = selObj.userData.element;
    if (!tag) continue;
    const info = elementLastInfo.get(tag.id) || meterLastInfo.get(tag.id);
    if (info && info.x_mm !== undefined) {
      selObj.position.set(info.x_mm/1000, info.y_mm/1000, info.z_mm/1000);
      any = true;
    }
  }
  if (any) { doRecompute(); refreshAfterRecompute(); State.pushHistory(); }
}


/* ========= Ribbons & Readouts ========= */
let ribbonMeshes = [];
const beamGroup = new THREE.Group(); scene.add(beamGroup);
const gratingLastInfo = new Map();
const meterLastInfo = new Map();
const elementLastInfo = new Map();

/* ========= Polarization ellipse helper ========= */
function dominantAxisLabel(vec) {
    const comps = [
        { label: vec.x >= 0 ? '+X' : '-X', mag: Math.abs(vec.x) },
        { label: vec.y >= 0 ? '+Y' : '-Y', mag: Math.abs(vec.y) },
        { label: vec.z >= 0 ? '+Z' : '-Z', mag: Math.abs(vec.z) }
    ];
    comps.sort((a, b) => b.mag - a.mag);
    return comps[0].label;
}

function svgPolEllipse(info) {
    const J = info?.jones;
    const dir = info?.outgoingDir;
    if (!Array.isArray(J) || J.length < 2) {
        const psiDeg = info?.psi_deg ?? info?.psiDeg ?? 0;
        const chiDeg = info?.chi_deg ?? info?.chiDeg ?? 0;
        const a = 46;
        const chiRad = chiDeg * Math.PI / 180;
        const b = Math.max(1, a * Math.abs(Math.tan(chiRad)));
        return `<svg width="160" height="120" viewBox="-80 -60 160 120" xmlns="http://www.w3.org/2000/svg"><style>.axis{stroke:#7d8590;stroke-width:1}.ell{stroke:#e6edf3;stroke-width:2;fill:none}.box{fill:none;stroke:#30363d;stroke-width:1}</style><line class="axis" x1="-64" y1="0" x2="64" y2="0"/><line class="axis" x1="0" y1="-44" x2="0" y2="44"/><g transform="rotate(${(-psiDeg).toFixed(2)})"><ellipse class="ell" cx="0" cy="0" rx="${a}" ry="${b}"/></g><rect class="box" x="-75" y="-55" width="150" height="110" rx="6" ry="6"/></svg>`;
    }

    const samples = 96;
    const points = [];
    let maxAbs = 1e-6;
    for (let i = 0; i <= samples; i++) {
        const phase = (i / samples) * Math.PI * 2;
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        const x = J[0].re * c + J[0].im * s;
        const y = J[1].re * c + J[1].im * s;
        points.push([x, y]);
        maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    }

    const scale = 46 / maxAbs;
    const pathD = points.map(([x, y], idx) =>
        `${idx === 0 ? 'M' : 'L'} ${(x * scale).toFixed(2)} ${(-y * scale).toFixed(2)}`
    ).join(' ');

    let axisLabels = '';
    if (dir?.isVector3) {
        const { u, v } = buildTransverseBasis(dir, info?.basisUp);
        axisLabels = [
            `<text x="66" y="-4" fill="#7d8590" font-size="10" text-anchor="start">H≈${dominantAxisLabel(v)}</text>`,
            `<text x="4" y="-48" fill="#7d8590" font-size="10" text-anchor="start">V≈${dominantAxisLabel(u)}</text>`
        ].join('');
    }

    return `<svg width="160" height="120" viewBox="-80 -60 160 120" xmlns="http://www.w3.org/2000/svg"><style>.axis{stroke:#7d8590;stroke-width:1}.ell{stroke:#e6edf3;stroke-width:2;fill:none}.box{fill:none;stroke:#30363d;stroke-width:1}</style><line class="axis" x1="-64" y1="0" x2="64" y2="0"/><line class="axis" x1="0" y1="-44" x2="0" y2="44"/><path class="ell" d="${pathD}"/><rect class="box" x="-75" y="-55" width="150" height="110" rx="6" ry="6"/>${axisLabels}</svg>`;
}

function svgPolEllipsePanel(info) {
    const J = info?.jones;
    const dir = info?.outgoingDir;
    if (!Array.isArray(J) || J.length < 2) {
        return svgPolEllipse(info);
    }

    const samples = 96;
    const points = [];
    let maxAbs = 1e-6;
    for (let i = 0; i <= samples; i++) {
        const phase = (i / samples) * Math.PI * 2;
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        const x = J[0].re * c + J[0].im * s;
        const y = J[1].re * c + J[1].im * s;
        points.push([x, y]);
        maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    }

    const scale = 46 / maxAbs;
    const pathD = points.map(([x, y], idx) =>
        `${idx === 0 ? 'M' : 'L'} ${(x * scale).toFixed(2)} ${(-y * scale).toFixed(2)}`
    ).join(' ');

    let axisLabels = '';
    if (dir?.isVector3) {
        const { u, v } = buildTransverseBasis(dir, info?.basisUp);
        axisLabels = [
            `<text x="72" y="-2" fill="#7d8590" font-size="10" text-anchor="end" dominant-baseline="middle">H&#8776;${dominantAxisLabel(v)}</text>`,
            `<text x="0" y="-50" fill="#7d8590" font-size="10" text-anchor="middle">V&#8776;${dominantAxisLabel(u)}</text>`
        ].join('');
    }

    return `<svg width="160" height="120" viewBox="-80 -60 160 120" xmlns="http://www.w3.org/2000/svg"><style>.axis{stroke:#7d8590;stroke-width:1}.ell{stroke:#e6edf3;stroke-width:2;fill:none}.box{fill:none;stroke:#30363d;stroke-width:1}</style><line class="axis" x1="-64" y1="0" x2="64" y2="0"/><line class="axis" x1="0" y1="-44" x2="0" y2="44"/><path class="ell" d="${pathD}"/><rect class="box" x="-75" y="-55" width="150" height="110" rx="6" ry="6"/>${axisLabels}</svg>`;
}

/* ========= Selected element panel ========= */
let elFolder = gui.addFolder("Selected Element");
const ui = { kind: "--" };

let _refreshingSelectedUI = false;

function refreshSelectedUI() {
    // Guard against re-entrant refreshes (controller callbacks can fire while
    // folders are being rebuilt), which used to leak duplicate output folders.
    if (_refreshingSelectedUI) return;
    _refreshingSelectedUI = true;
    try {
        refreshSelectedUIInner();
    } finally {
        _refreshingSelectedUI = false;
        // Dynamic folders are rebuilt often; localize synchronously so titles
        // and cleanup checks never see mixed English/Chinese states.
        localizeGui(gui.domElement);
    }
}

function refreshSelectedUIInner() {
    elFolder.destroy();
    elFolder = gui.addFolder("Selected Element");
    elFolder.open();

    // Remove the tracked output folder and any orphaned ones from older renders.
    outFolder?.destroy?.();
    outFolder = null;
    if (Array.isArray(gui.folders)) {
        for (const folder of [...gui.folders]) {
            const title = folder?.domElement?.querySelector(':scope > .title')?.textContent ?? '';
            if (title.includes('输出光束参数') || title.includes('Output Beam Characteristics')) {
                folder.destroy();
            }
        }
    }
    Ruler.destroyRulerUI();

    const selObj = selected.size === 1 ? [...selected][0] : tcontrols.object;

    // Update the values in the gizmo UI inputs
    if (selObj) {
        document.getElementById('gizmo-pos-x').value = (selObj.position.x * 1000).toFixed(1);
        document.getElementById('gizmo-pos-y').value = (selObj.position.y * 1000).toFixed(1);
        document.getElementById('gizmo-pos-z').value = (selObj.position.z * 1000).toFixed(1);
        syncRoleGizmoUI();

        selObj.rotation.order = 'YXZ';
        document.getElementById('gizmo-rot-yaw').value = THREE.MathUtils.radToDeg(selObj.rotation.y).toFixed(1);
        document.getElementById('gizmo-rot-tilt').value = THREE.MathUtils.radToDeg(selObj.rotation.x).toFixed(1);

        const baseWidth = selObj.geometry?.parameters?.width;
        const baseHeight = selObj.geometry?.parameters?.height;
        const widthInput = document.getElementById('gizmo-scale-width');
        const heightInput = document.getElementById('gizmo-scale-height');
        const widthLabel = document.getElementById('gizmo-scale-width-label');
        const heightLabel = document.getElementById('gizmo-scale-height-label');

        if (baseWidth) {
            widthInput.value = (selObj.scale.x * baseWidth * 1000).toFixed(1);
            if (widthLabel) widthLabel.innerText = 'Width (mm)';
        } else {
            widthInput.value = selObj.scale.x.toFixed(2);
            if (widthLabel) widthLabel.innerText = 'Width';
        }
        if (baseHeight) {
            heightInput.value = (selObj.scale.y * baseHeight * 1000).toFixed(1);
            if (heightLabel) heightLabel.innerText = 'Height (mm)';
        } else {
            heightInput.value = selObj.scale.y.toFixed(2);
            if (heightLabel) heightLabel.innerText = 'Height';
        }
    }

    if (!selObj) {
        elFolder.close();
        return;
    }

    if (selObj.userData.isRulerPoint) {
        elFolder.close();
        const rulerContext = { scene, selectable, tcontrols, pushHistory: State.pushHistory, isRestoringState: State.isRestoring() };
        Ruler.buildRulerUI(gui, State.pushHistory, rulerContext);
        Ruler.updateRuler();
        return;
    }
    // ==== Multi-selection UI (show when >1 objects selected) ====
    if (typeof selected !== 'undefined' && selected.size > 1) {
    // Header shows "N objects"
    ui.kind = `${selected.size} objects`;
    elFolder.add(ui, "kind").name("Selected").disable?.();

    // Actions that operate on the whole selection
    const actionsFolder = elFolder.addFolder('Actions');
    const buttonActions = {
        'Duplicate': duplicateSelectedElements,
        'Delete': deleteSelectedElements,
        'Center to Beam': centerSelectedElementToBeam,
    };

    const dupCtrl = actionsFolder.add(buttonActions, 'Duplicate');
    const delCtrl = actionsFolder.add(buttonActions, 'Delete');
    const centerCtrl = actionsFolder.add(buttonActions, 'Center to Beam');

    // Same styling you already use
    const container = actionsFolder.domElement.querySelector('.children');
    if (container) {
        container.style.display = 'flex';
        container.style.justifyContent = 'space-around';
        container.style.gap = '4px';
        container.style.padding = '4px';
        [dupCtrl, delCtrl, centerCtrl].forEach(ctrl => {
        if (ctrl?.domElement) {
            ctrl.domElement.style.flex = '1';
            const btn = ctrl.domElement.querySelector('button');
            if (btn) btn.style.width = '100%';
        }
        });
    }
    const titleElement = actionsFolder.domElement.querySelector('.title');
    if (titleElement) titleElement.style.display = 'none';

    // IMPORTANT: stop here so we don't render single-element property editors
    return;
    }

    // --- Standard Element and Source UI ---
    outFolder = gui.addFolder("Output Beam Characteristics");
    outFolder.open();
    try {
        gui.domElement.insertBefore(outFolder.domElement, elFolder.domElement.nextSibling);
    } catch (e) { }

    const tag = selObj.userData.element || null;
    ui.kind = selObj ? (tag?.type ?? "--") : "--";
    elFolder.add(ui, "kind").name("Type").disable?.();

    const e = elements.find(x => x.mesh === selObj) || (tag?.type === 'source' ? null : elements.find(x => x.id === tag?.id));
    const info = e ? (elementLastInfo.get(e.id) || meterLastInfo.get(e.id)) : null;

    if (e) {
        ui.label = e.props.label || '';
        elFolder.add(ui, 'label').name('Label').onFinishChange(value => {
            e.props.label = value;
            updateElementLabel(e);
            GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
            State.pushHistory();
        });
    }
    {
        const fr = outFolder;

        const mk = (name, val) => {
            const row = { txt: val };
            const ctrl = fr.add(row, "txt").name(name);
            const dom = ctrl.domElement?.closest?.(".controller");
            if (dom) { dom.style.pointerEvents = "none"; dom.style.opacity = "0.9"; }
        };

        if (info) {
            // Special display for Multimeter
            if (tag?.type === 'multimeter') {
                mk("Beam Radius w (µm)", (isFinite(info.w_um) ? info.w_um.toFixed(3) : "—"));
                mk("Radius of Curvature (mm)", (isFinite(info.R_mm) ? info.R_mm.toFixed(2) : "—"));
                mk("Wavelength (nm)", (isFinite(info.wavelength_nm) ? info.wavelength_nm.toFixed(2) : "—"));
                mk("Relative Intensity", (isFinite(info.Irel) ? info.Irel.toFixed(3) : "—"));
            } else {
                // Standard display for all other elements
                mk("Relative Intensity", (isFinite(info.Irel) ? info.Irel.toFixed(3) : "—"));
                mk("Waist w₀ (µm)", (isFinite(info.w0_um) ? info.w0_um.toFixed(3) : "—"));
                mk("Distance to Waist (mm)", (isFinite(info.z_to_waist_mm) ? info.z_to_waist_mm.toFixed(2) : "—"));
                mk("Rayleigh zR (mm)", (isFinite(info.zR_mm) ? info.zR_mm.toFixed(2) : "—"));
            }

            // Polarization angles and ellipse graphic (common to all)
            const psi = info.psi_deg ?? info.psiDeg;
            const chi = info.chi_deg ?? info.chiDeg;
            mk("Polarization Ψ (deg)", isFinite(psi) ? psi.toFixed(2) : "—");
            mk("Ellipticity χ (deg)", isFinite(chi) ? chi.toFixed(2) : "—");
            
            const holder = document.createElement('div');
            holder.className = 'pol-ellipse-holder';
            holder.style.padding = '8px 8px 2px 8px';
            holder.style.display = 'flex';
            holder.style.justifyContent = 'center';
            holder.style.alignItems = 'center';
            holder.innerHTML = svgPolEllipsePanel(info);

            // Remove previous holders we added (if any) and append
            try {
                for (const el of Array.from(fr.domElement.querySelectorAll('.pol-ellipse-holder'))) el.remove();
            } catch (e) { }
            fr.domElement.appendChild(holder);
        } else {
            outFolder.close();
        }
    }

    // ----- Angle of Incidence (editable if beam is hitting) -----
    if (info && info.aoi_deg !== undefined && info.incomingDir) {
        ui.aoi_deg = Number(info.aoi_deg.toFixed(2));
        live(
            elFolder.add(ui, "aoi_deg", 0, 90, 0.1).name("Incidence (deg)"),
            v => {
                // Find the most up-to-date info, as it might have changed since the panel was built
                const currentInfo = elementLastInfo.get(tag.id) || meterLastInfo.get(tag.id);
                if (!currentInfo || !currentInfo.incomingDir || !tcontrols.object) return;

                const selObj = tcontrols.object;
                const deltaAngleRad = THREE.MathUtils.degToRad(v - currentInfo.aoi_deg);

                // Get current normal in world space
                const nOld = new THREE.Vector3(0, 0, 1).applyQuaternion(selObj.quaternion);
                // Rotation axis is perpendicular to incoming ray and current normal
                const axis = new THREE.Vector3().crossVectors(currentInfo.incomingDir, nOld).normalize();

                // Handle case where vectors are parallel (axis is zero vector)
                if (axis.lengthSq() < 1e-6) {
                    // This happens at near-normal incidence. Any rotation axis in the element's plane is valid.
                    // We'll use the element's local X-axis (world-transformed) as a stable default.
                    axis.set(1, 0, 0).applyQuaternion(selObj.quaternion).normalize();
                }

                const rotQuat = new THREE.Quaternion().setFromAxisAngle(axis, deltaAngleRad);

                // Apply rotation: q_new = rotQuat * q_old
                selObj.quaternion.premultiply(rotQuat);

                // Ensure there's no "roll" (rotation about Z in local YXZ frame)
                const euler = new THREE.Euler().setFromQuaternion(selObj.quaternion, 'YXZ');
                euler.z = 0;
                selObj.setRotationFromEuler(euler);

                doRecompute();
            }
        );
    }

    // ----- Source: per-source controls (bandwidth included) -----
    if (tag?.type === 'source') {
        const src = Sources.sources.find(s => s.group === selObj);
        if (src) {
            Sources.buildSourceUI(elFolder, src, live, ui);
        }
    }

    // Lens
    if (tag?.type === "lens") {
        const e = elements.find(x => x.mesh === selObj); if (e) {
            ui.f_mm = e.props.f * 1e3;
            live(elFolder.add(ui, "f_mm", -10000, 10000, 0.1).name("f (mm)"),
                v => { e.props.f = Number(v) * 1e-3; updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); });
        }
    }

    // Thick Lens
    if (tag?.type === "thickLens") {
        const e = elements.find(x => x.mesh === selObj); if (e) {
            refreshThickLensVisual(e);

            ui.tl_R1_mm = (Number(e.props.R1) || 0) * 1e3;
            ui.tl_R2_mm = (Number(e.props.R2) || 0) * 1e3;
            ui.tl_n = Number.isFinite(Number(e.props.n)) ? Number(e.props.n) : 1.5;

            let tMin_m = Math.max(1e-6, Number(e.props._thicknessMin) || 1e-6);
            let tCur_m = Number(e.props.thickness);
            if (!Number.isFinite(tCur_m) || tCur_m < tMin_m) {
                tCur_m = Math.max(tMin_m, 0.004);
                e.props.thickness = tCur_m;
                refreshThickLensVisual(e);
                tMin_m = Math.max(1e-6, Number(e.props._thicknessMin) || 1e-6);
            }
            const tCur_mm = tCur_m * 1e3;
            const tMin_mm = tMin_m * 1e3;
            const tMax_mm = Math.max(tCur_mm * 3, tMin_mm + 0.1, 50);
            ui.tl_thick_mm = tCur_mm;

            live(elFolder.add(ui, "tl_R1_mm", -20000, 20000, 0.1).name("R1 (mm)"),
                v => {
                    e.props.R1 = Number(v) * 1e-3;
                    clampThickLensSizeToR(e.mesh, e.props.R1, e.props.R2);
                    refreshThickLensVisual(e);
                    updateElementLabel(e);
                    GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                    doRecompute();
                });

            live(elFolder.add(ui, "tl_R2_mm", -20000, 20000, 0.1).name("R2 (mm)"),
                v => {
                    e.props.R2 = Number(v) * 1e-3;
                    clampThickLensSizeToR(e.mesh, e.props.R1, e.props.R2);
                    refreshThickLensVisual(e);
                    updateElementLabel(e);
                    GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                    doRecompute();
                });

            live(elFolder.add(ui, "tl_n").name("Index n"),
                v => {
                    const nVal = Number(v);
                    e.props.n = (Number.isFinite(nVal) && nVal > 0) ? nVal : 1.5;
                    updateElementLabel(e);
                    GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                    doRecompute();
                });

            live(elFolder.add(ui, "tl_thick_mm", tMin_mm, tMax_mm, 0.01).name("Thickness (mm)"),
                v => {
                    const tMinLocal_m = Math.max(1e-6, Number(e.props._thicknessMin) || 1e-6);
                    let t_m = Number(v) * 1e-3;
                    t_m = Math.max(tMinLocal_m, t_m);
                    e.props.thickness = t_m;
                    refreshThickLensVisual(e);
                    updateElementLabel(e);
                    GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                    doRecompute();
                });
        }
    }

    // Unified Mirror + Dichroic UI
if (tag?.type === "mirror") {
    const e = elements.find(x => x.mesh === selObj); if (e) {
        ui.m_flat = !!e.props.flat;
        ui.R_mm = e.props.R * 1e3;
        ui.m_refl = (e.props.refl ?? 1);
        ui.m_dich = !!e.props.dichroic;
        // Material index of refraction for spherical mirror substrate
        ui.m_n = (e.props.n ?? 1.5);

        ui.reflMin_nm = e.props.reflBand_nm?.min ?? 400;
        ui.reflMax_nm = e.props.reflBand_nm?.max ?? 700;
        ui.transMin_nm = e.props.transBand_nm?.min ?? 700;
        ui.transMax_nm = e.props.transBand_nm?.max ?? 1100;

        let rCtrl;

        elFolder.add(ui, "m_flat").name("Flat (R = ∞)").onChange(v => {
            e.props.flat = !!v;
            updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
            refreshMirrorVisual(e);
            doRecompute(); refreshAfterRecompute(); State.pushHistory();
        });

        // R change (mm → m)
        rCtrl = elFolder.add(ui, "R_mm", -20000, 20000, 0.1).name("Radius R (mm)")
            .onFinishChange(v => {
                e.props.R = Number(v) * 1e-3;
                if (!e.props.flat) clampMirrorSizeToR(e.mesh, e.props.R);
                updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                refreshMirrorVisual(e);
                doRecompute(); refreshAfterRecompute(); State.pushHistory();
            });
                    // --- Thickness (spherical only): distance from vertex to planar back (mm) ---
        if (!e.props.flat && Number.isFinite(e.props.R)) {
            const isConcave = e.props.R > 0;   // R > 0  → concave
            const isConvex  = e.props.R < 0;   // R < 0  → convex

            // Geometry-based minimum only matters for convex mirrors (R < 0)
            const tGeomMin_m = (isConvex ? e.props._thicknessMin : 0) || 0;

            let tCur_m = e.props.thickness;
            if (!Number.isFinite(tCur_m) || tCur_m < tGeomMin_m) {
                // Default to something sensible if missing / too small
                tCur_m = Math.max(tGeomMin_m, 1.8e-4); // ~0.18 mm
                e.props.thickness = tCur_m;
            }

            const tCur_mm = tCur_m * 1e3;
            const tMin_mm = tGeomMin_m * 1e3;   // 0 for concave, geom-min for convex

            // Give the user a LOT of headroom:
            //  - at least 50 mm
            //  - at least 3× current value
            //  - and always above tMin
            const tMax_mm = Math.max(tCur_mm * 3, tMin_mm + 0.1, 50);

            ui.m_thick_mm = tCur_mm;

            live(
                elFolder.add(ui, "m_thick_mm", tMin_mm, tMax_mm, 0.01)
                    .name("Thickness (mm)"),
                v => {
                    let t_m = Number(v) * 1e-3;

                    if (isConvex) {
                        // For convex, enforce the geometric minimum so surfaces never overlap
                        const min_m = (e.props._thicknessMin || 0);
                        t_m = Math.max(min_m, t_m);
                    } else {
                        // For concave, user can choose any thickness ≥ 0 freely
                        t_m = Math.max(0, t_m);
                    }

                    e.props.thickness = t_m;
                    refreshMirrorVisual(e);
                    doRecompute();
                }
            );
        }

                // Show substrate index only for spherical mirrors (dummy variable for now)
        if (!e.props.flat && Number.isFinite(e.props.R)) {
            live(
                elFolder.add(ui, "m_n").name("Index n"),
                v => {
                    const nVal = Number(v);
                    // Keep it sane; fall back to 1.5 if invalid
                    e.props.n = (Number.isFinite(nVal) && nVal > 0) ? nVal : 1.5;
                    // Currently unused in ray-trace, but stored for future upgrades
                    doRecompute();
                }
            );
        }

        const reflCtrl = live(elFolder.add(ui, "m_refl", 0, 1, 0.01).name("Reflectance"),
            v => { e.props.refl = Math.min(1, Math.max(0, Number(v))); updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); });

            elFolder.add(ui, "m_dich").name("Dichroic")
                .onChange(v => {
                    e.props.dichroic = !!v;
                    updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                    if (v) { reflCtrl.disable?.(); } else { reflCtrl.enable?.(); }
                    const row = reflCtrl.domElement?.closest?.(".controller");
                    if (row) { row.style.opacity = v ? "0.5" : "1.0"; row.style.pointerEvents = v ? "none" : "auto"; }
                    doRecompute(); refreshAfterRecompute();
                    State.pushHistory();
                });

            const fr = elFolder.addFolder("Dichroic Bands (nm)");
            const enableBands = (on) => { fr.domElement.style.opacity = on ? "1.0" : "0.5"; fr.domElement.style.pointerEvents = on ? "auto" : "none"; };
            const clampRange = (minKey, maxKey, apply) => (() => {
                const minV = Number(ui[minKey]), maxV = Number(ui[maxKey]);
                if (Number.isFinite(minV) && Number.isFinite(maxV)) {
                    if (minV > maxV) { const t = ui[minKey]; ui[minKey] = ui[maxKey]; ui[maxKey] = t; }
                    apply();
                }
            });

            fr.add(ui, "reflMin_nm").name("Reflect min")
                .onFinishChange(clampRange("reflMin_nm", "reflMax_nm", () => {
                    e.props.reflBand_nm = { min: Number(ui.reflMin_nm), max: Number(ui.reflMax_nm) };
                    updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); refreshAfterRecompute(); State.pushHistory();
                }));
            fr.add(ui, "reflMax_nm").name("Reflect max")
                .onFinishChange(clampRange("reflMin_nm", "reflMax_nm", () => {
                    e.props.reflBand_nm = { min: Number(ui.reflMin_nm), max: Number(ui.reflMax_nm) };
                    updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); refreshAfterRecompute(); State.pushHistory();
                }));
            fr.add(ui, "transMin_nm").name("Transmit min")
                .onFinishChange(clampRange("transMin_nm", "transMax_nm", () => {
                    e.props.transBand_nm = { min: Number(ui.transMin_nm), max: Number(ui.transMax_nm) };
                    updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); refreshAfterRecompute(); State.pushHistory();
                }));
            fr.add(ui, "transMax_nm").name("Transmit max")
                .onFinishChange(clampRange("transMin_nm", "transMax_nm", () => {
                    e.props.transBand_nm = { min: Number(ui.transMin_nm), max: Number(ui.transMax_nm) };
                    updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); refreshAfterRecompute(); State.pushHistory();
                }));

            if (e.props.flat) {
                const row = rCtrl?.domElement?.closest?.(".controller");
                if (row) { row.style.opacity = "0.5"; row.style.pointerEvents = "none"; }
            }
            if (e.props.dichroic) {
                reflCtrl.disable?.();
                const row = reflCtrl.domElement?.closest?.(".controller");
                if (row) { row.style.opacity = "0.5"; row.style.pointerEvents = "none"; }
            }
            enableBands(!!e.props.dichroic);
        }
    }

    // Polarization elements
    if (tag?.type === "polarizer") {
        const e = elements.find(x => x.mesh === selObj); if (e) {
            ui.axis_deg = e.props.axisDeg;
            live(elFolder.add(ui, "axis_deg", -180, 180, 1).name("Axis angle (deg)"),
                v => {
                    e.props.axisDeg = Number(v);
                    if (e.ugi && e.ugi.setAngle) e.ugi.setAngle(Number(v));
                    doRecompute();
                });
        }
    }
    if (tag?.type === "waveplate") {
        const e = elements.find(x => x.mesh === selObj); if (e) {
            ui.axis_deg = e.props.axisDeg;
            ui.waveplate_type = e.props.type || "HWP";
            ui.delta_deg = THREE.MathUtils.radToDeg(e.props.delta);

            live(elFolder.add(ui, "axis_deg", -180, 180, 1).name("Fast-axis (deg)"),
                v => {
                    e.props.axisDeg = Number(v);
                    if (e.ugi && e.ugi.setAngle) e.ugi.setAngle(Number(v));
                    doRecompute();
                });

            const deltaCtrl = live(elFolder.add(ui, "delta_deg", 0, 720, 1).name("Retardance Δ (deg)"),
                v => {
                    e.props.delta = THREE.MathUtils.degToRad(Number(v));
                    updateElementLabel(e);
                    GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                    doRecompute();
                });

            const toggleDeltaControl = (enabled) => {
                if (deltaCtrl) {
                    const row = deltaCtrl.domElement?.closest?.(".controller");
                    if (row) {
                        row.style.opacity = enabled ? "1.0" : "0.5";
                        row.style.pointerEvents = enabled ? "auto" : "none";
                    }
                }
            };

            elFolder.add(ui, "waveplate_type", {
                '半波片': 'HWP', '四分之一波片': 'QWP', '自定义': 'Custom',
            }).name("Type")
                .onChange(v => {
                    e.props.type = v;
                    if (v === "HWP") {
                        e.props.delta = Math.PI;
                        toggleDeltaControl(false);
                    } else if (v === "QWP") {
                        e.props.delta = Math.PI / 2;
                        toggleDeltaControl(false);
                    } else {
                        toggleDeltaControl(true);
                    }

                    ui.delta_deg = THREE.MathUtils.radToDeg(e.props.delta);
                    deltaCtrl.updateDisplay();

                    updateElementLabel(e);
                    GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                    doRecompute();
                    refreshAfterRecompute();
                    State.pushHistory();
                });

            toggleDeltaControl(e.props.type === 'Custom');
        }
    }
    if (tag?.type === "faraday") {
        const e = elements.find(x => x.mesh === selObj); if (e) {
            ui.faraday_deg = e.props.phiDeg;
            live(elFolder.add(ui, "faraday_deg", -180, 180, 1).name("Rotation (deg)"),
                v => { e.props.phiDeg = Number(v); updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); });
        }
    }

    // Beam Splitter / PBS
    if (tag?.type === "beamSplitter") {
        const e = elements.find(x => x.mesh === selObj); if (!e) return;
        ui.bs_polarizing = e.props.polarizing;
        ui.bs_transmit = e.props.polTransmit || "Vertical";
        ui.bs_R = e.props.R ?? 0.5;

        ui._bsRController = live(elFolder.add(ui, "bs_R", 0, 1, 0.01).name("Reflectance R"),
            v => { e.props.R = Math.min(1, Math.max(0, Number(v))); updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); });

        const polCtrl = elFolder.add(ui, "bs_polarizing").name("Polarizing (PBS)");

        const transmitCtrl = elFolder.add(ui, "bs_transmit", {
            '垂直': 'Vertical', '水平': 'Horizontal',
        }).name("PBS transmits")
            .onChange(v => { e.props.polTransmit = v; updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize); doRecompute(); refreshAfterRecompute(); State.pushHistory(); });

        const toggleTransmitControl = (enabled) => {
            if (transmitCtrl) {
                const row = transmitCtrl.domElement?.closest?.(".controller");
                if (row) {
                    row.style.opacity = enabled ? "1.0" : "0.5";
                    row.style.pointerEvents = enabled ? "auto" : "none";
                }
            }
        };

        polCtrl.onChange(v => {
            e.props.polarizing = !!v;
            updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
            v ? ui._bsRController.disable() : ui._bsRController.enable();
            toggleTransmitControl(!!v);
            doRecompute(); refreshAfterRecompute(); State.pushHistory();
        });

        if (e.props.polarizing) {
            ui._bsRController.disable?.();
        }
        toggleTransmitControl(e.props.polarizing);
    }

    // ----- Diffraction Grating -----
    if (tag?.type === "grating") {
        const e = elements.find(x => x.mesh === selObj); if (!e) return;

        ui.gr_mode = (e.props.mode === "transmissive") ? "Transmissive" : "Reflective";
        
        // Initialize both values based on the source of truth (e.props.d_um)
        ui.gr_d_um = e.props.d_um;
        ui.gr_lines_mm = 1000 / e.props.d_um; // 1 mm = 1000 microns
        
        ui.gr_orders = e.props.orders;

        elFolder.add(ui, "gr_mode", {
                '反射式': 'Reflective', '透射式': 'Transmissive',
            }).name("Type")
            .onChange(v => {
                e.props.mode = (v === "Transmissive" ? "transmissive" : "reflective");
                updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
                doRecompute(); refreshAfterRecompute();
                State.pushHistory();
            });

        // Define controllers for Spacing (d) and Density (Lines/mm)
        const cD = elFolder.add(ui, "gr_d_um", 0.05, 50, 0.001).name("Spacing d (µm)");
        const cL = elFolder.add(ui, "gr_lines_mm", 20, 4000, 1).name("Lines/mm");

        // Helper to sync visuals after property change
        const updateGratingVisuals = () => {
            updateElementLabel(e); 
            GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
            doRecompute();
        };

        // Handle Spacing Slider Change (Drive lines/mm)
        live(cD, v => {
            const d = Math.max(1e-6, Number(v));
            e.props.d_um = d;
            
            // Update coupled slider
            ui.gr_lines_mm = 1000 / d;
            cL.updateDisplay();
            
            updateGratingVisuals();
        });

        // Handle Lines/mm Slider Change (Drive d)
        live(cL, v => {
            const lines = Math.max(1, Number(v));
            const d = 1000 / lines;
            e.props.d_um = d;

            // Update coupled slider
            ui.gr_d_um = d;
            cD.updateDisplay();

            updateGratingVisuals();
        });

        const cM = elFolder.add(ui, "gr_orders", 0, 10, 1).name("± Orders");
        live(cM, v => {
            e.props.orders = Math.max(0, Math.floor(Number(v)));
            updateElementLabel(e); GizmoUI.correctLabelScale(e.mesh, params.labelFontSize);
            doRecompute();
        });

        const info = gratingLastInfo.get(e.id);
        const fr = elFolder.addFolder("Orders (Show, θ, Dispersion)");
        if (info) {
            const hdr = { text: `Incidence α ≈ ${info.alphaDeg.toFixed(2)}°` };
            fr.add(hdr, "text").name("α (deg)").disable?.();

            if (!e.props.visibleOrders) e.props.visibleOrders = {};

            for (const ent of info.entries) {
                const m = String(ent.m);
                if (e.props.visibleOrders[m] === undefined) {
                    e.props.visibleOrders[m] = true;
                }
                const label = `m=${m}: θ=${ent.thetaDeg.toFixed(2)}°, D=${(ent.disp_deg_per_nm === Infinity ? '∞' : ent.disp_deg_per_nm.toFixed(4))} °/nm`;
                fr.add(e.props.visibleOrders, m).name(label)
                    .onFinishChange(() => {
                        doRecompute();
                        State.pushHistory();
                    });
            }
        } else {
            const none = { hint: "(Aim a beam at this grating to populate angles)" };
            fr.add(none, "hint").name("—");
        }
    }

    const actionsFolder = elFolder.addFolder('Actions');
    const buttonActions = {
        'Duplicate': duplicateSelectedElements,
        'Delete': deleteSelectedElements,
        'Center to Beam': centerSelectedElementToBeam,
    };

    const dupCtrl = actionsFolder.add(buttonActions, 'Duplicate');
    const delCtrl = actionsFolder.add(buttonActions, 'Delete');
    const centerCtrl = actionsFolder.add(buttonActions, 'Center to Beam');

    // Disable the center button if no beam information is available
    if (!info) {
        centerCtrl.disable();
    }
    
    // Use CSS to style the buttons horizontally
    const container = actionsFolder.domElement.querySelector('.children');
    if (container) {
        container.style.display = 'flex';
        container.style.justifyContent = 'space-around';
        container.style.gap = '4px';
        container.style.padding = '4px';
        
        // Make individual button containers flexible
        [dupCtrl, delCtrl, centerCtrl].forEach(ctrl => {
            if (ctrl && ctrl.domElement) {
                ctrl.domElement.style.flex = '1';
                const button = ctrl.domElement.querySelector('button');
                if (button) {
                    button.style.width = '100%';
                }
            }
        });
    }

    // Hide the folder title to make it look like a seamless part of the panel
    const titleElement = actionsFolder.domElement.querySelector('.title');
    if (titleElement) {
        titleElement.style.display = 'none';
    }
}

// A map of functions for recreating elements from their type string, needed by state.js
const recreateFuncs = {
    'lens': makeLens, 'thickLens': makeThickLens, 'mirror': makeMirror, 'polarizer': makePolarizer,
    'waveplate': makeWaveplate, 'faraday': makeFaraday, 'beamSplitter': makeBeamSplitter,
    'beamBlock': makeBeamBlock, 'grating': makeGrating, 'multimeter': makeMultimeter
};

State.init({
    params, sources: Sources.sources, elements, selectable, ugiPickables, scene, grid, tcontrols,
    addSource: Sources.addSource, addElement, removeSourceByGroup: Sources.removeSourceByGroup, syncSourceW0ZR: Sources.syncSourceW0ZR,
    doRecompute, refreshSelectedUI,
    Ruler, GizmoUI,
    beamWidthScaleController, showGridController, showLabelsController, labelFontSizeController,
    recreateFuncs, refreshMirrorVisual, refreshThickLensVisual
});

/* ========= Demo ========= */
addElement(makeLens({ f: 0.05 }), new THREE.Vector3(0, 0, 0.05));
const mirrorEl = addElement(makeMirror({ flat: true, refl: 1.0 }), new THREE.Vector3(0, 0, 0.135));
mirrorEl.mesh.rotation.y = Math.PI / 4;
const source = Sources.addSource({ position: new THREE.Vector3(0, 0, 0) });
source.props.wavelength_nm = 530;
source.props.waist_w0_um = 200;
Sources.syncSourceW0ZR(source);
refreshSelectedUI();

/* ========= Live scene mirror / host bridge ========= */
const sessionSceneId = crypto.randomUUID();
let sessionSeed = 42;
const elementUuids = new WeakMap();

function uuidForObject(obj) {
    let uuid = elementUuids.get(obj);
    if (uuid) return uuid;

    const tagProps = obj?.userData?.element?.props;
    const source = Sources.sources.find((candidate) => candidate.group === obj);
    const props = source?.props ?? tagProps;
    if (props && typeof props.__bbUuid === 'string') {
        elementUuids.set(obj, props.__bbUuid);
        return props.__bbUuid;
    }

    uuid = crypto.randomUUID();
    elementUuids.set(obj, uuid);
    // Persist through captureState/restoreState so undo/redo keeps identity.
    if (props) props.__bbUuid = uuid;
    return uuid;
}

function buildSceneSnapshot() {
    return sceneFromUpstream({
        sceneId: sessionSceneId,
        seed: sessionSeed,
        camera: {
            position: camera.position,
            target: orbit.target,
            fov: THREE.MathUtils.degToRad(camera.fov),
        },
        elements: elements.map((el) => ({
            uuid: uuidForObject(el.mesh),
            type: el.type,
            mesh: el.mesh,
            props: el.props,
        })),
        sources: Sources.sources.map((src) => ({
            uuid: uuidForObject(src.group),
            group: src.group,
            props: src.props,
        })),
        table: { ...TABLE_BOUNDS, cellSize: 0.025 },
    });
}

let lastSyncSignature = null;
let uiMutationDepth = 0;

function sceneSignature(scene) {
    return JSON.stringify({
        seed: scene.seed,
        table: scene.table,
        elements: scene.elements,
        camera: scene.camera,
    });
}

function markSceneSynced() {
    try {
        lastSyncSignature = sceneSignature(buildSceneSnapshot());
    } catch {
        // A transient malformed UI state must not break editing.
    }
}

function syncSceneMirror() {
    if (!commandExecutor) return 0;
    if (uiMutationDepth > 0) return commandExecutor.getRevision();
    try {
        const next = buildSceneSnapshot();
        const signature = sceneSignature(next);
        if (signature === lastSyncSignature) return commandExecutor.getRevision();
        const revision = commandExecutor.sync(next);
        lastSyncSignature = signature;
        if (window.__beambench) window.__beambench.revision = revision;
        return revision;
    } catch (err) {
        console.warn('[BeamBench] scene sync failed', err);
        return commandExecutor.getRevision();
    }
}

/* ========= UI write adapter (host commands → live scene) ========= */
function findUiElement(uuid) {
    for (const el of elements) {
        if (uuidForObject(el.mesh) === uuid) return { element: el, object: el.mesh };
    }
    for (const src of Sources.sources) {
        if (uuidForObject(src.group) === uuid) return { source: src, object: src.group };
    }
    return null;
}

function polUiPreset(value) {
    switch (value) {
        case 'H': return 'Linear X';
        case 'V': return 'Linear Y';
        case 'D': return 'Diagonal';
        case 'A': return 'Anti-diagonal';
        case 'RL': return 'Circular L';
        case 'R': return 'Circular R';
        default: return value;
    }
}

function applySourceProps(src, props) {
    if (typeof props.wavelength_nm === 'number') src.props.wavelength_nm = props.wavelength_nm;
    if (typeof props.forward_cm === 'number') src.props.forward_cm = props.forward_cm;
    if (typeof props.backward_cm === 'number') src.props.backward_cm = props.backward_cm;
    if (typeof props.polPreset === 'string') src.props.polPreset = polUiPreset(props.polPreset);
    if (typeof props.waist_um === 'number') src.props.waist_w0_um = props.waist_um * 1e6;
    if (typeof props.intensity_rel === 'number') src.props.intensity_rel = props.intensity_rel;
    Sources.syncSourceW0ZR(src);
}

function createUpstreamElement(kind, props, name) {
    const label = name;
    switch (kind) {
        case 'lens': return makeLens({ f: Number(props.focalLength_m) || 0.1, label });
        case 'thickLens': return makeThickLens({
            R1: Number(props.R1) || 0.05,
            R2: Number(props.R2) || -0.05,
            n: Number(props.n) || 1.5,
            thickness: Number(props.thickness) || 0.004,
            label,
        });
        case 'mirror': return makeMirror({
            flat: true,
            R: Number(props.R) || 2.0,
            refl: Number.isFinite(props.reflectivity) ? props.reflectivity : 1.0,
            label,
        });
        case 'polarizer': return makePolarizer({
            axisDeg: Number(props.axisAngleDeg) || 0, label,
        });
        case 'waveplate': return makeWaveplate({
            ...waveplateParams(props),
            label,
        });
        case 'faraday': return makeFaraday({
            phiDeg: Number.isFinite(props.phiDeg) ? props.phiDeg : 45, label,
        });
        case 'bs':
        case 'pbs': return makeBeamSplitter({
            R: Number.isFinite(props.reflectivity) ? props.reflectivity : 0.5,
            polarizing: kind === 'pbs' || props.polarizing === true,
            polTransmit: props.polTransmit === 'Horizontal' ? 'Horizontal' : 'Vertical',
            label,
        });
        case 'beamDump': return makeBeamBlock({ label });
        case 'grating': return makeGrating({
            mode: props.mode === 'transmissive' ? 'transmissive' : 'reflective',
            d_um: Number(props.d_um) || 1.0,
            orders: Number(props.orders) || 1,
            label,
        });
        case 'detector': return makeMultimeter({ label });
        default: return null;
    }
}

const DEFAULT_UI_MOUNT = {
    pivotPoint: [0, 0, 0],
    axes: {
        tiltX: { min: -0.1, max: 0.1 },
        tiltY: { min: -0.1, max: 0.1 },
        rotationZ: { min: 0, max: Math.PI },
    },
};

function upstreamElementState(el) {
    const p = el.props ?? {};
    const common = {
        __bbUuid: el.uuid,
        __bbMount: structuredClone(el.mount ?? DEFAULT_UI_MOUNT),
        label: el.name ?? p.label,
    };
    let type = null;
    let props = null;

    switch (el.kind) {
        case 'lens':
            type = 'lens';
            props = { ...common, f: Number(p.focalLength_m) || 0.1 };
            break;
        case 'thickLens':
            type = 'thickLens';
            props = {
                ...common,
                R1: Number(p.R1) || 0.05,
                R2: Number(p.R2) || -0.05,
                n: Number(p.n) || 1.5,
                thickness: Number(p.thickness) || 0.004,
            };
            break;
        case 'mirror':
            type = 'mirror';
            props = {
                ...common,
                flat: true,
                R: Number(p.R) || 2.0,
                refl: Number.isFinite(p.reflectivity) ? p.reflectivity : 1.0,
            };
            break;
        case 'polarizer':
            type = 'polarizer';
            props = { ...common, axisDeg: Number(p.axisAngleDeg) || 0 };
            break;
        case 'waveplate':
            type = 'waveplate';
            props = {
                ...common,
                ...waveplateParams(p),
            };
            break;
        case 'faraday':
            type = 'faraday';
            props = { ...common, phiDeg: Number.isFinite(p.phiDeg) ? p.phiDeg : 45 };
            break;
        case 'bs':
        case 'pbs':
            type = 'beamSplitter';
            props = {
                ...common,
                R: Number.isFinite(p.reflectivity) ? p.reflectivity : 0.5,
                polarizing: el.kind === 'pbs' || p.polarizing === true,
                polTransmit: p.polTransmit === 'Horizontal' ? 'Horizontal' : 'Vertical',
            };
            break;
        case 'beamDump':
            type = 'beamBlock';
            props = { ...common };
            break;
        case 'grating':
            type = 'grating';
            props = {
                ...common,
                mode: p.mode === 'transmissive' ? 'transmissive' : 'reflective',
                d_um: Number(p.d_um) || 1.0,
                orders: Number(p.orders) || 1,
            };
            break;
        case 'detector':
            type = 'multimeter';
            props = { ...common };
            break;
        default:
            return null;
    }

    return {
        type,
        props,
        position: [...el.pose.position],
        quaternion: [...el.pose.orientation],
        scale: [2, 2, 2],
    };
}

function upstreamSourceState(el) {
    const p = el.props ?? {};
    return {
        props: {
            ...p,
            __bbUuid: el.uuid,
            __bbMount: structuredClone(el.mount ?? DEFAULT_UI_MOUNT),
            beamMode: el.kind === 'raysSource' ? 'rays' : 'gaussian',
            beamModeLabel: undefined,
            polPreset: polUiPreset(p.polPreset ?? 'H'),
            waist_w0_um: Number.isFinite(p.waist_um) ? p.waist_um * 1e6 : 200,
            label: el.name ?? p.label,
        },
        position: [...el.pose.position],
        quaternion: [...el.pose.orientation],
        scale: [2, 2, 2],
    };
}

const uiActions = {
    snapshot: buildSceneSnapshot,

    beforeMutation() {
        uiMutationDepth++;
    },

    afterMutation() {
        uiMutationDepth = Math.max(0, uiMutationDepth - 1);
        markSceneSynced();
    },

    addElement(kind, pose, props, name) {
        const uuid = crypto.randomUUID();
        const position = new THREE.Vector3(...pose.position);

        if (kind === 'source' || kind === 'raysSource') {
            const src = Sources.addSource({
                position,
                mode: kind === 'raysSource' ? 'rays' : 'gaussian',
            });
            src.group.quaternion.fromArray(pose.orientation);
            applySourceProps(src, props);
            src.props.__bbUuid = uuid;
            elementUuids.set(src.group, uuid);
            doRecompute();
            refreshAfterRecompute();
            State.pushHistory();
            return { uuid };
        }

        const element = createUpstreamElement(kind, props, name);
        if (!element) throw new Error(`Unsupported element kind: ${kind}`);
        element.props.__bbUuid = uuid;
        addElement(element, position);
        element.mesh.quaternion.fromArray(pose.orientation);
        elementUuids.set(element.mesh, uuid);
        return { uuid };
    },

    removeElement(uuid) {
        const found = findUiElement(uuid);
        if (!found) return false;

        if (found.source) {
            Sources.removeSourceByGroup(found.source.group);
        } else {
            const obj = found.element.mesh;
            if (selected.has(obj)) selected.delete(obj);
            scene.remove(obj);
            const si = selectable.indexOf(obj);
            if (si >= 0) selectable.splice(si, 1);
            const handle = found.element.ugi?.handle;
            if (handle) {
                const ui = ugiPickables.indexOf(handle);
                if (ui >= 0) ugiPickables.splice(ui, 1);
            }
            const index = elements.indexOf(found.element);
            if (index >= 0) elements.splice(index, 1);
        }

        tcontrols.detach();
        doRecompute();
        refreshAfterRecompute();
        State.pushHistory();
        return true;
    },

    setPose(uuid, pose) {
        const found = findUiElement(uuid);
        if (!found) return false;
        found.object.position.fromArray(pose.position);
        found.object.quaternion.fromArray(pose.orientation);
        doRecompute();
        refreshAfterRecompute();
        State.pushHistory();
        return true;
    },

    setDof(uuid, axis, min, max) {
        const found = findUiElement(uuid);
        if (!found) return false;
        const props = found.source ? found.source.props : found.element.props;
        const mount = structuredClone(props.__bbMount ?? DEFAULT_UI_MOUNT);
        mount.axes[axis] = { min, max };
        props.__bbMount = mount;
        State.pushHistory();
        return true;
    },

    loadScene(scene) {
        sessionSeed = Number.isInteger(scene.seed) ? scene.seed : sessionSeed;
        const state = {
            params: {
                beamWidthScale: params.beamWidthScale,
                showGrid: params.showGrid,
                showLabels: params.showLabels,
                labelFontSize: params.labelFontSize,
            },
            sources: [],
            elements: [],
            ruler: null,
        };

        for (const el of scene.elements) {
            if (el.kind === 'source' || el.kind === 'raysSource') {
                state.sources.push(upstreamSourceState(el));
                continue;
            }
            const mapped = upstreamElementState(el);
            if (!mapped) return false; // Unsupported kind (e.g. iris) — reject before applying.
            state.elements.push(mapped);
        }

        State.restore(state);
        doRecompute(true);
        refreshAfterRecompute();
        return true;
    },

    setParam(uuid, param, value) {
        const found = findUiElement(uuid);
        if (!found) return false;

        const props = found.source ? found.source.props : found.element.props;
        const kind = found.source ? 'source' : found.element.type;

        let uiParam = param;
        let uiValue = value;
        if (kind === 'mirror' && param === 'reflectivity') uiParam = 'refl';
        else if (kind === 'beamSplitter' && param === 'reflectivity') uiParam = 'R';
        else if (kind === 'polarizer' && param === 'axisAngleDeg') uiParam = 'axisDeg';
        else if (kind === 'waveplate' && param === 'fastAxisAngleDeg') uiParam = 'axisDeg';
        else if ((kind === 'lens' || kind === 'thickLens') && param === 'focalLength_m') uiParam = 'f';
        else if (kind === 'source' && param === 'polPreset') uiValue = polUiPreset(value);
        else if (kind === 'source' && param === 'waist_um') {
            uiParam = 'waist_w0_um';
            uiValue = Number(value) * 1e6;
        }

        if (!(uiParam in props)) return false;
        props[uiParam] = uiValue;

        if (found.source) Sources.syncSourceW0ZR(found.source);
        if (kind === 'mirror' && typeof refreshMirrorVisual === 'function') {
            refreshMirrorVisual(found.element);
        }
        if (kind === 'thickLens' && typeof refreshThickLensVisual === 'function') {
            refreshThickLensVisual(found.element);
        }

        doRecompute();
        refreshAfterRecompute();
        State.pushHistory();
        return true;
    },

    undo() {
        const before = JSON.stringify(buildSceneSnapshot().elements);
        State.undo();
        return JSON.stringify(buildSceneSnapshot().elements) !== before;
    },

    redo() {
        const before = JSON.stringify(buildSceneSnapshot().elements);
        State.redo();
        return JSON.stringify(buildSceneSnapshot().elements) !== before;
    },
};

try {
    commandExecutor = new UiCommandExecutor({
        actions: uiActions,
        initialScene: buildSceneSnapshot(),
    });
} catch (err) {
    console.warn('[BeamBench] initial command executor failed, using empty scene', err);
    commandExecutor = new UiCommandExecutor({
        actions: uiActions,
        initialScene: {
            schemaVersion: 1,
            sceneId: sessionSceneId,
            revision: 0,
            seed: 42,
            table: { ...TABLE_BOUNDS, cellSize: 0.025 },
            elements: [],
            camera: {
                position: [...camera.position.toArray()],
                target: [...orbit.target.toArray()],
                fov: THREE.MathUtils.degToRad(camera.fov),
            },
        },
    });
}
syncSceneMirror();

const captureService = new CaptureService({
    getRevision: () => commandExecutor.getRevision(),
    setView: (view) => setView(view),
    render: () => renderer.render(scene, camera),
    canvas: renderer.domElement,
});
commandExecutor.setCapture(captureService);

const hostBridge = new HostBridge({
    allowedOrigins: [window.location.origin],
    executor: commandExecutor,
});
window.addEventListener('message', (event) => {
    hostBridge.handleHandshake(event);
});

/* ========= Auto alignment ========= */
const ALIGNABLE_TYPES = new Set([
    'lens', 'thickLens', 'polarizer', 'waveplate', 'faraday', 'beamSplitter', 'multimeter',
]);

function showStatusToast(text, duration = 2800) {
    const toast = document.getElementById('training-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(trainingToastTimer);
    trainingToastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

/**
 * Put the source axis through transmissive optics and detectors.
 * Reflective elements keep their position/orientation (they fold the beam).
 */
function autoAlign() {
    const source = Sources.sources[0];
    const origin = source
        ? source.group.getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(0, 0, 0);
    const quat = source
        ? source.group.getWorldQuaternion(new THREE.Quaternion())
        : new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize();

    const candidates = [];
    if (selected.size > 0) {
        for (const object of selected) {
            const element = elements.find((candidate) => candidate.mesh === object);
            if (element && ALIGNABLE_TYPES.has(element.type)) candidates.push(element);
        }
    } else {
        candidates.push(...elements.filter((element) => ALIGNABLE_TYPES.has(element.type)));
    }

    let moved = 0;
    for (const element of candidates) {
        const current = element.mesh.position.clone();
        const along = current.clone().sub(origin).dot(axis);
        // Align along the full source axis (both in front of and behind it).
        const aligned = origin.clone().add(axis.clone().multiplyScalar(along));
        element.mesh.position.copy(aligned);
        element.mesh.quaternion.copy(quat);
        moved++;
    }

    if (moved > 0) {
        doRecompute();
        refreshAfterRecompute();
        State.pushHistory();
        showStatusToast(`已对齐 ${moved} 个透射器件（反射镜保持不动）`);
    } else {
        showStatusToast('没有可对齐的透射器件（请先放置光源/透镜等）');
    }
    return moved;
}

document.getElementById('auto-align')?.addEventListener('click', () => autoAlign());

/* ========= Boot / debug ========= */
document.getElementById('boot-status')?.remove();
const buildLabel = document.getElementById('bb-build');
if (buildLabel) buildLabel.textContent = BUILD_STAMP;

function setupDebugOverlay() {
    if (URL_PARAMS.get('debug') !== '1') return;
    const panel = document.createElement('pre');
    panel.id = 'bb-debug';
    Object.assign(panel.style, {
        position: 'fixed', left: '12px', bottom: '96px', zIndex: '25',
        margin: '0', padding: '8px 10px', maxWidth: '520px',
        fontSize: '11px', lineHeight: '1.5', color: '#c9d1d9',
        background: 'rgba(0,0,0,.7)', border: '1px solid #30363d',
        borderRadius: '8px', pointerEvents: 'none', whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(panel);

    setInterval(() => {
        const gl = renderer.getContext();
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        const gpu = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown';
        const stats = {
            build: BUILD_STAMP,
            revision: commandExecutor?.getRevision() ?? 0,
            elements: elements.length + Sources.sources.length,
            hardware: window.__beambench?.hardwareStats?.(),
            environment: window.__beambench?.environmentStats?.(),
        };
        panel.textContent = [
            `Build: ${stats.build}`,
            `URL: ${location.href}`,
            `WebGL: ${gpu}`,
            `Revision: ${stats.revision}  Elements: ${stats.elements}`,
            `Hardware mounts/meshes: ${stats.hardware?.mounts ?? 0}/${stats.hardware?.meshes ?? 0}`,
            `Table holes: ${stats.environment?.table?.holes ?? 0}`,
            `Training: ${stats.environment?.trainingMode ? 'on' : 'off'}`,
        ].join('\n');
    }, 1000);
}

/* ========= Test/diagnostic hook ========= */
window.__beambench = {
    version: 1,
    holePitch: HOLE_PITCH_M,
    table: TABLE_BOUNDS,
    lastPlacement: null,
    setView,
    get revision() {
        return commandExecutor ? commandExecutor.getRevision() : 0;
    },
    getScene: () => commandExecutor?.getScene() ?? null,
    observe: () => commandExecutor?.observe() ?? null,
    captureFrame: (view) => captureService.capture(view, commandExecutor.getRevision()),
    syncNow: () => syncSceneMirror(),
    cameraPosition: () => camera.position.toArray(),
    cameraState: () => ({
        position: camera.position.toArray(),
        target: orbit.target.toArray(),
        up: camera.up.toArray(),
        fov: camera.fov,
    }),
    environmentStats: () => {
        let contours = 0;
        scene.traverse((object) => {
            if (object.userData?.isContour) contours++;
        });
        return {
            table: grid.userData?.table ?? null,
            contours,
            trainingMode: document.body.classList.contains('training-mode'),
        };
    },
    setContours: (visible) => setContours(visible),
    selection: () => getSelectionInfo(),
    selectionRole: () => selectedRole,
    pickDebug: (clientX, clientY) => _raycasterFromEvent({ clientX, clientY })
        .intersectObjects(_collectPickables(), false)
        .slice(0, 6)
        .map((hit) => ({
            role: _hitRole(hit.object),
            handle: hit.object.userData?.handleRole ?? null,
            type: _hitTarget(hit.object)?.userData?.element?.type ?? null,
            distance: hit.distance,
        })),
    handleDebug: () => ({
        active: !!handleDrag,
        role: handleDrag?.role ?? null,
        lastHit: lastHandleHit,
        suppress: suppressSelectionClick,
        point: lastHandlePoint,
    }),
    selectionHandleInfo: () => {
        const seen = new Set();
        const rows = [];
        for (const handle of selectionHandlePickables) {
            const role = handle.userData.handleRole;
            if (seen.has(role)) continue;
            seen.add(role);
            const world = handle.getWorldPosition(new THREE.Vector3());
            const screen = world.clone().project(camera);
            rows.push({
                role,
                world: [world.x, world.y, world.z],
                screen: {
                    x: (screen.x * 0.5 + 0.5) * innerWidth,
                    y: (-screen.y * 0.5 + 0.5) * innerHeight,
                },
            });
        }
        return rows;
    },
    focusElement: (type, side = 1, distance = 0.07) => {
        const el = elements.find((element) => element.type === type);
        if (!el) return false;
        const target = el.mesh.getWorldPosition(new THREE.Vector3());
        camera.position.copy(target).add(new THREE.Vector3(
            distance * 0.35, distance * 0.25, distance * side
        ));
        orbit.target.copy(target);
        camera.lookAt(target);
        orbit.update();
        return true;
    },
    visualStats: () => {
        let apertureMounts = 0;
        const glass = new Set();
        const mirrors = new Set();
        scene.traverse((object) => {
            if (object.userData?.hasThroughAperture) apertureMounts++;
            if (!object.isMesh || !object.userData?.isVisualOnly) return;
            const material = object.material;
            if (material?.isMeshPhysicalMaterial && (material.transmission ?? 0) > 0.3) {
                glass.add(material.uuid);
            }
            if (material?.isMeshStandardMaterial && material.metalness >= 0.4 &&
                material.map && material.color && material.color.r > 0.9 &&
                material.color.g > 0.9) {
                mirrors.add(material.uuid);
            }
        });
        return {
            environment: !!scene.environment,
            apertureMounts,
            glassMaterials: glass.size,
            mirrorMaterials: mirrors.size,
        };
    },
    gizmoState: () => ({
        mode: currentGizmoMode(),
        bar: getComputedStyle(document.getElementById('gizmo-controls')).display,
        main: GizmoUI.tcontrols.main.visible,
        yaw: GizmoUI.tcontrols.yaw.visible,
        tilt: GizmoUI.tcontrols.tilt.visible,
        scale: GizmoUI.tcontrols.scale.visible,
    }),
    selectionHeightLimits: () => {
        if (selected.size !== 1) return null;
        return heightLimits([...selected][0]);
    },
    standMetrics: () => ({ ...STAND_METRICS }),
    mountInfo: () => {
        const rows = [];
        const collect = (obj, type, id) => {
            const stand = standRegistry.get(obj);
            const head = obj.getWorldPosition(new THREE.Vector3());
            const base = stand?.getWorldPosition(new THREE.Vector3());
            const quaternion = obj.getWorldQuaternion(new THREE.Quaternion());
            rows.push({
                type,
                id,
                head: [head.x, head.y, head.z],
                scale: [obj.scale.x, obj.scale.y, obj.scale.z],
                quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
                base: base ? [base.x, base.y, base.z] : null,
                tableTop: TABLE_TOP_Y,
                postHeight: stand?.userData.postHeight ?? null,
                headBottom: head.y + headBottomLocal(obj),
            });
        };
        elements.forEach((el) => collect(el.mesh, el.type, el.id));
        Sources.sources.forEach((src) => collect(src.group, 'source', src.group.userData?.element?.id));
        return rows;
    },
    hardwareStats: () => {
        let mounts = 0;
        let meshes = 0;
        scene.traverse((object) => {
            if (object.userData?.isHardware) mounts++;
            if (object.userData?.isHardwareMesh) meshes++;
        });
        return { mounts, meshes };
    },
    rendererInfo: () => ({
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
    }),
    build: BUILD_STAMP,
    snapToHoles: () => params.snapToHoles,
    setSnapToHoles: (enabled) => {
        params.snapToHoles = !!enabled;
        snapToHolesController?.updateDisplay?.();
        return params.snapToHoles;
    },
    autoAlign: () => autoAlign(),
    recomputeCount: () => _recomputeCount,
    elementCount: () => elements.length + Sources.sources.length,
    screenPointForWorld: (x, z) => {
        const v = new THREE.Vector3(x, 0, z).project(camera);
        return {
            x: (v.x * 0.5 + 0.5) * innerWidth,
            y: (-v.y * 0.5 + 0.5) * innerHeight,
        };
    },
    screenPoint3D: (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return {
            x: (v.x * 0.5 + 0.5) * innerWidth,
            y: (-v.y * 0.5 + 0.5) * innerHeight,
        };
    },
    elementPositions: () => [
        ...elements.map((el) => {
            const p = el.mesh.getWorldPosition(new THREE.Vector3());
            return { id: el.id, type: el.type, x: p.x, y: p.y, z: p.z };
        }),
        ...Sources.sources.map((src) => {
            const p = src.group.getWorldPosition(new THREE.Vector3());
            return {
                id: src.group.userData?.element?.id ?? null,
                type: 'source', x: p.x, y: p.y, z: p.z,
            };
        }),
    ],
};

setupDebugOverlay();

/* ========= Training view / contours ========= */
if (params.showContours) setContours(true);
if (!params.showLabels) applyLabelVisibility();
if (params.trainingView) applyTrainingMode(true);

/* ========= First compute ========= */
doRecompute();
State.pushHistory();

/* ========= Animation ========= */
const clock = new THREE.Clock();
function animate() {
    pol.animate(polGroup, clock.getElapsedTime());
    syncStands();
    orbit.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
animate();

/* ========= Resize ========= */
window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

/* ========= Warn Before Unload ========= */
window.addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; });
