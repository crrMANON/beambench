# 验收索引（AC01–AC10）

**日期**: 2026-10-17
**上游**: `47686d611b7b11121cfaf7be0583aee6ac34e9b0`（VisuPhy BeamBench）
**发行包**: `release/beambench-1.0.0-2026-10-17.tar.gz` / `.zip`（含 `RELEASE_MANIFEST.json`、`SHA256SUMS`）

| AC | 要求摘要 | 状态 | 证据 |
|---|---|---|---|
| AC01 | 离线运行、鼠标摆放、参考场景 | **PARTIAL** | 离线构建无远程引用；真实鼠标 E2E（[bench-interaction.spec.ts](../tests/e2e/bench-interaction.spec.ts)）；命令层 100 次唯一 UUID（[scene-contract.test.ts](../tests/domain/scene-contract.test.ts)）。未做浏览器 100 次拖动压力 |
| AC02 | 保存/载入往返、50 步撤销 | **VERIFIED** | [scene-contract.test.ts](../tests/domain/scene-contract.test.ts)、[scene-io.test.ts](../tests/domain/scene-io.test.ts)、宿主 `save_scene`/undo/redo E2E |
| AC03 | 反射/偏振/能量物理正确性 | **VERIFIED（v1 模型）** | [three-dimensional.test.ts](../tests/physics/three-dimensional.test.ts)、[trace-physics.test.ts](../tests/physics/trace-physics.test.ts)；能量闭合 ≤1e-8；模型限制写入 warnings |
| AC04 | 探测器与参考平面测量 | **VERIFIED** | [measurement.test.ts](../tests/physics/measurement.test.ts) 12 tests；浏览器 E2E：宿主添加 source + detector → observe 返回 hit/incidentPower/receivedRatio>0.9 |
| AC05 | BB84 统计与 seed 复现 | **PARTIAL** | [bb84.test.ts](../tests/qkd/bb84.test.ts) 17 tests；`run_bb84` 已接入页面与 E2E（2000 pulses）；光学模型目前由调用方提供，尚未从 TraceResult 自动推导 |
| AC06 | 准直基线 20 seeds | **PARTIAL** | [baseline.test.ts](../tests/alignment/baseline.test.ts) 10 tests（20 seeds 全部收敛、不可达失败）；未接入 UI |
| AC07 | 宿主桥与截图一致性 | **VERIFIED（同源）** | [host-bridge.test.ts](../tests/bridge/host-bridge.test.ts) 13；E2E：握手/get_state/observe/capture/save_scene/旧 revision/写命令/PNG 解码 |
| AC08 | Agent 回放确定性 | **PARTIAL** | [runner.test.ts](../tests/agent/runner.test.ts) 14、[host-environment.test.ts](../tests/agent/host-environment.test.ts) 4、浏览器假策略回放 E2E；真实模型未验 |
| AC09 | 30 器件 FPS/延迟/内存 | **BLOCKED_ENV** | [PERF_BROWSER.json](PERF_BROWSER.json)：SwiftShader 软件渲染，30 器件 5 s 采样 median 1.94 FPS、P95 2308 ms；按规则标 BLOCKED_ENV，不声称通过 |
| AC10 | 干净安装/无 CDN/许可证/发行 | **VERIFIED** | 冷目录 `npm ci`/typecheck/build:standalone/192 tests/file:// 单文件验证（[COLD_INSTALL.md](COLD_INSTALL.md)）；`NOTICE` + `SHA256SUMS` 校验通过 |

## 验证命令（最近一次）

```bash
npm run typecheck && npm run lint && npm run build:standalone
npm run test:unit:run        # 21 files / 208 tests
npx playwright test          # 15 tests
npm run verify:docs
npm run release              # archives + manifest + checksums
```

## 运行时诊断

- 黑屏排障：启动层错误 / `?debug=1` / HUD 构建时间（见 [STATUS](STATUS.md)）。
- WebGL 不可用时给出明确错误，而非黑屏。

## 明确未完成

1. **AC09**：需要带真实 GPU 的固定验收机重跑 30 s FPS / 200 操作 P95 / 100 次重载。
2. **AC05/AC06**：BB84 光学模型尚未从 TraceResult 推导；准直基线尚未接入页面。
3. **AC08**：真实模型评测（无凭据，明确未验）。
5. 鼠标/gizmo/检查器编辑尚未全部改为发命令（宿主写命令已覆盖完整集合）。
