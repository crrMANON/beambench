# BeamBench 当前交接

**Handoff**: 2026-10-18T11:41 | **Current Phase**: 写命令集 + 洞洞板实验室 + Thorlabs 硬件 + 训练视图；剩余 AC09 真机性能、BB84/准直接线与真实模型

## 当前事实

- P0–P3 完成：BB-02..08 已实现（状态/命令/传播/测量/交互/BB84/准直）。
- 最新验证全部通过：
  - `npm run typecheck` / `npm run lint` / `npm run build` / `npm run verify:docs`
  - `npm run test:unit:run` → 20 files, 207 tests
  - `npx playwright test` → 15 tests（鼠标、环境/训练视图、硬件、桥读写、截图、agent 回放）
  - 冷目录 `npm ci`/typecheck/build/166 tests/preview 200（见 `docs/COLD_INSTALL.md`）
- 构建离线自包含：无 importmap、无远程 import。
- 工作区不是 Git 仓库，无提交记录。

## 阅读顺序

1. `docs/STATUS.md`（唯一权威状态）
2. `docs/TASKS.md` BB-07/BB-08 与 DAG
3. `PLAN.md` §3.1（SceneV1/Observation）、§3.2（命令/宿主）、§3.3（BB84/对齐）
4. 代码：`src/domain/` → `src/physics/trace.ts` → `src/physics/measurement.ts`
   → `src/interaction/placement.ts` → `src/upstream/main.js`（应用装配）

## 已完成实现要点

- `src/domain/scene*.ts`：tuple 化 SceneV1、校验、序列化、深拷贝 50 步历史。
- `src/domain/commands.ts`：乐观锁、幂等缓存、只读/变更分离、undo/redo 单调 revision。
- `src/physics/trace.ts`：显式源的队列式传播、分支/损失/截断、能量闭合。
- `src/physics/measurement.ts`：探测器/参考平面测量，高斯圆孔积分，不修改 trace。
- `src/interaction/placement.ts`：25mm 吸附、台面边界、重叠检测、DOF 限幅。
- `src/upstream/main.js`：修复 palette id；鼠标/HTML5 拖放 token；摆放吸附/碰撞；
  三视角相机；`window.__beambench` 诊断钩子。
- `src/qkd/bb84.ts`：四通道 BB84 采样、版本化 PRNG、光学 hash 缓存失效。
- `src/alignment/baseline.ts`：阻尼最小二乘、20-seed 基线、不可达终止。
- `src/core/rng.ts`：共享 mulberry32-v1。
- `src/bridge/`：Origin 白名单、MessagePort 握手、1 MiB/队列 16、幂等转发；
  `examples/host/` SDK 与宿主页（尚未在应用入口接线）。
- `src/render/capture.ts`：同 revision 显式 render + toBlob、版本漂移/超限拒绝。
- `src/integration/`：上游状态 → SceneV1 快照；SceneMirror 提供读命令；
  UiCommandExecutor 提供 add/remove/setPose/setParam/undo/redo 并应用到 UI。
- 命令期间抑制中间 sync；每次命令 revision 只 +1；UUID 经 props 持久化，undo/redo 稳定。
- 应用入口已创建 CaptureService 与 HostBridge（同源白名单）。
- `src/agent/host-environment.ts` + `runner.ts`：E2E 用假策略完成 add→capture→stop 回放。
- `run_bb84` 命令已接入场景修订与桥协议；浏览器 E2E 覆盖 2000 pulses。
- E2E 覆盖宿主添加 source+detector 后 observe 的 hit/功率/接收比。
- 写命令覆盖 add/remove/setPose/setParam/setDof/undo/redo/reset/load_scene；DOF 限位、
  seed 与 UUID 均可持久化；上游隐式源行为已移除。
- Thorlabs 风格程序化硬件（镜架/压圈/旋钮/柱/底座/旋转刻度环）随光具自动挂载，
  visual-only，不影响物理；`src/upstream/hardware.js` + 5 个单测 + E2E。
- 自由摆放（默认不吸附孔位，可开启“吸附到孔位”）；自动准直按钮把透射器件/探测器
  排到光源轴线上（反射镜保持不动）；训练视图退出按钮/H/Esc 快捷键。
- 底座/立柱/光学头分离；底座贴台面，立柱随高度伸缩且限位；底座绿色 XZ 手柄、
  头部红/蓝高度箭头、顺/逆时针旋转面板；光源与所有光学头均由立柱支撑。
- 底栏保留并随角色切换：底座显示 X/Y 数字输入；头部显示 Z 高度输入，
  “旋转”模式恢复环形 gizmo；多选恢复三模式。
- 修复重复“输出光束参数”面板：刷新防重入 + 清理同名孤儿文件夹；E2E 覆盖。
- 光具/镜架/光源模型整体 ×1.5；右侧去掉“视图与变换”和“旋转”子栏，
  重置相机置顶栏；旋转保留在底栏环形 gizmo。
- 镜架改为前后通透镜框；玻璃/镜面材质与环境反射；光束可穿过透镜；
  `visualStats()`、`focusElement()` 可用于检查。
- 侧视严格水平、台面成线并自动取景全部光具（默认再拉远 30%）；俯视由侧视绕
  水平轴旋转 90°，左右顺序一致；场景变化时自动重新取景（手动 Orbit 后停止）。
- 镜架/支柱/底座参与拾取并映射回所属器件（`attachTarget` + `_collectPickables`），
  放置后仍可通过光学面或任意硬件选中；`__beambench.selection()` 可诊断。
- 银灰铝合金洞洞板（25 mm 孔距/2052 孔）、增强且可调的光照（环境光/主光/补光）、
  中文界面（菜单/检查器/调色板/视角/3D 标签）；`src/upstream/i18n.js` + 3 个单测。
- 洞洞板实验室环境（25 mm 孔距/2052 孔/腿/地面）与 CV 训练视图：
  `src/upstream/environment.js` + 3 个单测；`?training=1`、快捷键 `h`、Bench 视角、
  类型色环与可选轮廓线。
- `tools/benchmark.ts`：CPU 模块基准（trace/measurement/BB84/alignment/commands）。
- E2E：`tests/e2e/bench-interaction.spec.ts`（Chromium headless，workers=1，串行）。

## 未完成 / 不要声称完成

- domain 尚未成为上游 UI 的唯一状态源（双状态共存）。这是后续集成的首要技术债。
- 鼠标/检查器编辑尚未“发命令”，是快照收敛而非单一命令管线。
- setDof/load_scene/reset 的 UI 写入、真实 agent 模型、BB-13 浏览器性能未验。
- BB-14 发行归档未做（冷安装已通过）。
- 未做人工视觉验收；未做鼠标 100 次连续压力测试（仅命令层 100 次唯一 ID）。
- trace/measurement 为 v1 简化模型：无限平面、无薄透镜 q/ABCD、无斜入射椭圆投影。
- 上游 roll clearing bug 仍存在（roll≈0 workaround）。

## 打开方式（避免黑屏）

- 不要双击 `beambench.html` / `dist/beambench.html`：ES module 在 `file://` 下被浏览器阻止。
- 使用 `npm run dev`、`npm run preview`，或 `npm run build:standalone` 后打开
  `dist/beambench-standalone.html`（已验证 file:// 渲染与 1280×720 PNG）。
- file:// 下 HostBridge 不适用（opaque origin）；诊断用 `__beambench.captureFrame(view)`。

## 发行

- `npm run release` → `release/beambench-1.0.0-2026-10-17.tar.gz` / `.zip`
  （88 files，`RELEASE_MANIFEST.json` + `SHA256SUMS`，校验通过）。
- 冷目录当前代码：`npm ci`、typecheck、build:standalone、192 tests、file:// 单文件渲染全部通过。
- 验收索引：`docs/ACCEPTANCE_INDEX.md`；浏览器性能：`docs/PERF_BROWSER.json`（BLOCKED_ENV）。

## 黑屏诊断

- 启动层会显示加载/WebGL/脚本错误；`?debug=1` 展示 build、WebGL renderer、revision、
  器件/硬件/台面孔数。HUD 显示构建时间。
- 当前 `file://` 单文件在本机正常；用户若仍黑屏，请收集启动层文字或 debug 面板。

## 下一步（优先级）

1. 鼠标/gizmo/检查器编辑改为发命令，完成单一管线。
2. **BB-13**：在真实 GPU 机器上重跑 30 器件 / 30s FPS / 200 操作 P95 / 100 次重载内存。
3. 接入 `run_bb84`、准直场景、浏览器探测器读数 E2E；真实模型评测标注未验。

## 失败处理

- 不以降低 PLAN 阈值或删除断言的方式让测试通过；修正实现或明确记录模型限制。
- 无法人工验证的项必须在 STATUS 中写明“未验”，不得记为通过。
