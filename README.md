# BeamBench - 3D Optical Laboratory for Human-AI Interaction

<div align="center">

**Version:** 1.0.0 | **License:** GPL-3.0-or-later | **Node:** >=20.0.0

</div>

## Overview

BeamBench provides an embedded 3D optical laboratory where humans and AI agents can perform experiments using the same interaction semantics: placing optical components, mechanical alignment, beam collimation, and BB84 quantum key distribution teaching.

### Features

- **3D Workspace**: Interactive optical bench with mouse dragging, gizmo-based manipulation, and snapping to grid
- **Scaled models**: optical heads, mounts and stands are 1.5× larger (scale 3 vs the old 2) for visibility and CV data.
- **Realistic optics**: lenses/BS/waveplates use physical glass (transmission/IOR) on round apertures; mirrors use a reflective metallic surface with a procedural silver gradient and scene environment reflections. Mounts are open frames with front and rear retaining rings, so light and the beam pass through lenses and both sides are visible.
- **Thorlabs-style hardware**: separate optical head and base/post stand. The base always sits on the breadboard; the round post telescopes with the optic height. Clicking the base shows a green XZ handle and the bottom bar exposes X/Y numeric inputs; clicking the post/head shows red/blue vertical arrows, a Z-height input and a Rotate button that brings back the ring gizmos. Post length and optic height are clamped so the rod never leaves or pierces the base, and the source head no longer floats.
- **Lab environment**: 1.4 m × 1.0 m **silver-gray aluminum** breadboard with 25 mm M6 hole grid (instanced), perimeter frame, legs and a lab floor
- **Chinese UI**: menus, inspector, palette, camera buttons and 3D element labels are localized; lighting sliders (环境光/主光/补光) are adjustable. “重置相机” sits in the top view bar; rotation lives in the bottom bar (ring gizmo), not in the inspector.
- **CV/training view**: per-type accent rings, optional high-contrast silhouette contours, clean `?training=1` view that hides labels/UI/gizmos, plus Bench/Top/Front/Side cameras. Side view is perfectly horizontal (the table projects to a line) and auto-frames all optics with a 30% pulled-back default; Top view is the same framing rotated 90° about the horizontal axis, so both run right-to-left; a floating “退出训练视图 (H / Esc)” button always remains visible
- **Free placement + auto alignment**: optics can be dropped/dragged to any table position; optional 25 mm hole snapping (“吸附到孔位”, off by default). The “自动准直（排到同一直线）” action centers transmissive optics and detectors on the source axis and orients them to the beam; reflective elements keep their pose
- **Optical Physics**: Gaussian beam propagation (ABCD matrix), Jones calculus for polarization, limited aperture effects
- **BB84 Protocol**: Quantum key distribution simulation with ideal photon counting
- **Alignment Tools**: Two-mirror collimation with optimization algorithms
- **Host Integration**: iframe + MessageChannel bridge for embedding in larger systems
- **Agent Support**: Deterministic agent loop with budget limits and replay capability

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Host Application                          │
│                    (iframe + MessageChannel)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────▼───────────────┐
           │    src/bridge/                │
           │    Host-RPC layer             │
           └───────────────┬───────────────┘
                           │
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
┌───▼───┐            ┌─────▼─────┐         ┌─────▼─────┐
│Domain │            │  Physics  │        │Interaction│
│Scene  │◄──────────►│Trace &    │◄───────►│Mouse/Gizmo│
│V1     │   Commands│ Measurement│         │Controls   │
└───────┘            └─────┬─────┘         └────────────┘
                           │
                    ┌──────▼───────┐
                    │  Upstream    │
                    │ Three.js     │
                    │ Optics Module│
                    └──────────────┘
```

### Key Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Core | `src/core/` | Versioned deterministic PRNG |
| Domain | `src/domain/` | SceneV1 state, commands, versioning |
| Physics | `src/physics/` | TraceResult computation, measurements |
| Interaction | `src/interaction/` | Hole snapping, table bounds, DOF clamping |
| Render | `src/render/` | Revision-safe frame capture service |
| QKD | `src/qkd/` | BB84 four-channel event sampler |
| Alignment | `src/alignment/` | Damped least-squares alignment baseline |
| Bridge | `src/bridge/` | Origin-checked MessagePort RPC bridge |
| Agent | `src/agent/` | Budgeted, replayable observe/act loop |
| Host example | `examples/host/` | iframe SDK and minimal host page |

## Getting Started

### Prerequisites

- Node.js 20.0.0 or higher
- npm 9.0.0 or higher
- Chrome/Chromium browser (for E2E tests)

### Installation

```bash
npm ci
```

### Training / CV capture

```text
http://localhost:5173/beambench.html?training=1
```

Training mode hides labels, DOM panels and selection gizmos, enables contour
edges and uses the same revision-safe `capture` API. Press `h` to toggle the
clean view at any time. Use the **Bench**, **Top**, **Front** and **Side**
camera presets for multi-view training data.

### Opening the app

Do **not** double-click `beambench.html` or `dist/beambench.html`: browsers block
ES modules loaded from `file://`, so the page stays dark.

Use one of these instead:

```bash
# 1. Development server
npm run dev                 # http://localhost:5173

# 2. Production preview
npm run build
npm run preview             # http://localhost:4173/beambench.html

# 3. Single-file build for double-click / offline file:// use
npm run build:standalone
open dist/beambench-standalone.html
```

The ordinary build intentionally shows a guidance overlay when opened from
`file://`; `dist/beambench-standalone.html` is self-contained (bundle inlined,
no imports) and runs without a server.

**Black screen troubleshooting**

- A boot overlay now reports loading/errors instead of leaving a dark page.
  If it says “浏览器无法创建 WebGL 上下文”, enable hardware acceleration/WebGL or
  use Chrome/Edge.
- Append `?debug=1` to show build time, WebGL renderer, revision, element count,
  hardware mesh count and table hole count.
- The HUD also shows the build timestamp. Confirm the filename uses a hyphen:
  `dist/beambench-standalone.html` (not `beambench_standalone`).
- Do not open the file from Quick Look/Preview; use a real browser.

### Build

```bash
npm run build
```

Creates optimized bundle in `dist/`.

### Testing

```bash
# Unit tests (domain, physics, math)
npm run test:unit:run

# E2E tests (browser interaction; Chromium must be installed once)
npx playwright install chromium
npx playwright test

# CPU benchmark
npm run test:perf

# Browser performance (FPS, operation latency, reload memory)
npm run test:perf:browser

# Source release archives + checksums
npm run release

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Acceptance Criteria (v1)

All product verification against PLAN.md §4 standards:

| ID | Description | Status |
|----|-------------|--------|
| BB-AC01 | Offline operation, mouse placement | Verified for build + real-mouse E2E; 100-drag browser stress pending |
| BB-AC02 | Save/load roundtrip, 50 undo/redo steps | Verified (unit) |
| BB-AC03 | Physical correctness (reflection, energy closure) | Verified for the v1 tracer model |
| BB-AC04 | Detector measurements, reference planes | Verified (unit); UI wiring pending |
| BB-AC05 | BB84 statistics with seed verification | Verified sampler; scene wiring pending |
| BB-AC06 | Alignment baseline (20 seeds) | Verified analytic baseline; UI wiring pending |
| BB-AC07 | Host bridge, screenshot consistency | Verified in-browser: read/write commands, revision-matched PNG, stable UUIDs across undo/redo |
| BB-AC08 | Agent replay with determinism | Scripted-policy replay verified in-browser; real model unverified |
| BB-AC09 | Performance | CPU benchmark available; browser FPS not measured |
| BB-AC10 | Clean environment install, docs complete | Verified: cold install, 192 tests, standalone file:// build, release archives with SHA-256 |

See [`docs/STATUS.md`](docs/STATUS.md) for the authoritative evidence and gaps.

## Scenarios

Three JSON scenarios are included:

1. **Two-Mirror Alignment** (`scenarios/two-mirror.json`)
2. **Collimation** (`scenarios/collimation.json`)
3. **BB84 Baseline** (`scenarios/bb84.json`)

The alignment fixtures are analytic paraxial models in v1; the BB84 scene is
represented by its four-channel optical model rather than an assembled 3D scene.

## Known Limitations

- No hardware control integration; single-user, single-session only.
- The domain state machine and the upstream Three.js UI still coexist; a single
  source of truth for the interactive UI is not wired yet.
- v1 tracer uses infinite element planes and does not apply thin-lens ABCD/q
  propagation; measurement assumes a circular Gaussian spot.
- The host bridge, capture service and agent runner are connected and verified
  in the browser. Host writes support add/remove/setPose/setParam/setDof/
  load_scene/reset/undo/redo. Mouse/gizmo edits still update the UI directly and
  are mirrored into the same revision rather than being emitted as commands.
- V1 targets desktop Chrome; no cloud services are required (offline-first).

## Documentation

See the [docs/](docs/) directory:

- [`PLAN.md`](PLAN.md) - Full engineering specification
- [`docs/TASKS.md`](docs/TASKS.md) - Task breakdown by phase
- [`docs/STATUS.md`](docs/STATUS.md) - Authoritative current progress
- [`docs/RESEARCH.md`](docs/RESEARCH.md) - Source investigation findings
- [`docs/DECISIONS.md`](docs/DECISIONS.md) - Architectural choices
- [`docs/HANDOFF.md`](docs/HANDOFF.md) - Phase handoff summary
- [`docs/ACCEPTANCE_INDEX.md`](docs/ACCEPTANCE_INDEX.md) - AC01–AC10 evidence index and gaps
- [`docs/COLD_INSTALL.md`](docs/COLD_INSTALL.md) - Clean-install evidence

## Contribution

This project is released under GPL-3.0-or-later. Any modifications must preserve license compatibility and credit the original authors (VisuPhy).

For this development effort:
- Maintain upstream source integrity
- Document patches in DECISIONS.md
- Verify all changes against acceptance criteria
- Update STATUS.md with actual evidence

## Version History

- **2026-10-17 development milestone**
  - Upstream SHA `47686d611b7b11121cfaf7be0583aee6ac34e9b0` imported; offline build.
  - Domain state machine, atomic commands, v1 tracer, measurement, interaction,
    BB84 sampler, alignment baseline, host bridge, capture service and agent loop.
  - 208 unit tests + 15 browser tests passing (free placement/snap, Chinese UI,
    environment/training view + exit, auto alignment, hardware/stand roles,
    base + height + rotation handles, single output panel, glass/mirror
    materials, views, bridge read/write, capture, detector measurement,
    agent replay).
- **v1.0.0**: Initial planning and architecture definition (P0-P5).

---

**Copyright © 2025 VisuPhy. GNU General Public License v3.0+**  
*Derived work for educational research in quantum optics and human-AI interaction.*

## 模块化光具库补充

原版默认界面与场景保留。新增数据型偏振库，可按[安装说明](docs/OPTICS_LIBRARIES.md)独立接入或移除；`npm run build:basic`输出基础实验室到`dist-basic/`。本阶段只扩展原生器件预设。
根目录`RELEASE_MANIFEST.json`和`SHA256SUMS`属于恢复的历史发行快照；修改后的发行包请以重新执行`npm run release`生成的包内清单为准。

