# BeamBench 当前实际状态

更新：2026-10-18T11:41（本机时间）。长度预算≤120 行；只记录已验证事实，不把目标状态当完成。

## 验证命令（最近一次全部通过）

```bash
npm run typecheck     # exit 0
npm run lint          # exit 0
npm run build         # exit 0, dist/assets/index-*.js 616.46 kB
npm run test:unit:run # exit 0, 20 files / 207 tests passed
npm run test:perf -- --fixture acceptance-v1 --seed 42  # exit 0, JSON report
# 冷目录（排除 node_modules/dist）：npm ci ✓ typecheck ✓ build ✓ 166 tests ✓ preview 200
npx playwright test   # exit 0, 15 tests passed (mouse, environment/training, hardware, bridge read/write, capture, run_bb84, detector, agent replay)
npm run verify:docs   # exit 0
npm run build:standalone # exit 0, dist/beambench-standalone.html (0.66 MiB)
npm run release          # exit 0, release/*.tar.gz + *.zip + SHA256SUMS
```

离线检查：`dist/beambench.html` 无 importmap、无远程脚本；打包产物中无第三方 CDN import
（仅剩 three/lil-gui 源码内的提示性 URL 文本）。`three@0.161.0` 与 `lil-gui@0.18` 均从
`node_modules` 打包。

## 任务状态

| 任务 | 状态 | 证据 |
|---|---|---|
| BB-00 | ✅ DONE | 上游 SHA `47686d6` 已导入；离线构建通过 |
| BB-01 | ✅ DONE | `tests/physics/three-dimensional.test.ts` 10 tests |
| BB-02 | ✅ DONE | `tests/domain/scene-contract.test.ts` + `scene-io.test.ts` |
| BB-03 | ✅ DONE | `tests/domain/commands.test.ts` 13 tests |
| BB-04 | ✅ DONE | `tests/physics/trace-physics.test.ts` 9 tests |
| BB-05 | ✅ DONE（自动化） | `tests/interaction/placement.test.ts` 13 + `tests/e2e/bench-interaction.spec.ts` 4 |
| BB-06 | ✅ DONE | `tests/physics/measurement.test.ts` 12 tests |
| BB-07 | ✅ DONE | `tests/qkd/bb84.test.ts` 17 tests |
| BB-08 | ✅ DONE | `tests/alignment/baseline.test.ts` 10 tests |
| BB-09 | ✅ WIRED | 读写命令 + 浏览器 E2E；add/remove/setPose/setParam/undo/redo 可用 |
| BB-10 | ✅ WIRED | capture 8 unit + 浏览器 E2E；同 revision PNG 可解码 |
| BB-11 | ✅ REPLAY E2E | runner 14 + host-env 4 + 浏览器假策略回放；真实模型未验 |
| BB-12 | 🟡 PARTIAL | 读/写命令与 UI 集成；AC09 浏览器性能未测 |
| BB-13 | 🟡 BLOCKED_ENV | CPU 基准通过；浏览器为 SwiftShader，AC09 标 BLOCKED_ENV |
| BB-14 | ✅ DONE | 冷安装 192 tests、file:// 单文件、release 归档 + SHA256 校验通过 |

## BB-02 状态与持久化（已完成）

- `src/domain/scene.ts`：SceneV1 / BaseElement / tuple 类型，无 THREE 依赖。
- `src/domain/scene-validation.ts`：有限数、UUID、四元数、DOF、按元件类型的参数校验。
- `src/domain/scene-io.ts`：序列化/反序列化、先验证后载入、深拷贝历史、50 步 undo/redo。
- 行为：未知版本/坏 JSON/重复 UUID/NaN/畸形 tuple 均被拒绝，现有场景不被替换。
- 证据：`tests/domain/scene-contract.test.ts`（直接调用真实模块）。

## BB-03 原子命令（已完成）

- `src/domain/commands.ts`：`expectedRevision` 乐观锁、只读命令不递增 revision、
  候选状态校验后提交、失败不写历史、requestId 幂等缓存（16 条，同 ID 不同参数拒绝）。
- add 返回新 UUID；100 次 add/remove 产生 100 个唯一 UUID 且全部移除成功。
- undo/redo 恢复快照同时单调递增 revision。
- `observe` 返回 detectors + traceStatus + modelLimits；`execute` 返回 trace 摘要。
- 证据：`tests/domain/commands.test.ts`（13）+ `scene-contract.test.ts`（12）。

## BB-04 TraceResult（已完成，v1 模型）

- `src/physics/trace.ts`：仅显式 active source 产生光束；队列式传播；分支/损失/截断显式记录；
  无限元件平面求交、镜面反射、BS 分束、偏振片 Jones 投影、光阑/探测器有限孔径；
  `length_m` 限制参考平面重复计数；`beamRadius_m` 携带 1/e² 半径。
- 能量闭合：输入功率 = 探测/吸收 + 损失 + 自由空间 + 队列剩余，容差 1e-8。
- 限制：薄透镜 ABCD/q 传播未实现；元件按无限平面处理；均在 `warnings` 中显式声明。

## BB-05 交互与摆放（已完成，自动化验证）

- `src/interaction/placement.ts`：25 mm 孔位吸附、台面边界、底座重叠、DOF 限幅（纯函数）。
- 应用入口修复：palette 缺少 `id="palette"` 导致所有拖放处理器未挂载；已修复。
- 新增桌面鼠标拖拽路径（pointerdown/move/up），与 HTML5 drag/drop 共享一次性 token，避免双次生成。
- 摆放时吸附孔位、限制在 1.2 m × 0.9 m 台面内并检测底座重叠；gizmo 拖动结束同样吸附。
- 新增三视角按钮（Perspective / Top / Front / Side），位于顶部中央。
- `window.__beambench` 暴露只读诊断：数量、位置、最近摆放结果与相机位置（供 E2E）。
- E2E（真实鼠标 + WebGL）：单镜摆放吸附；连续 3 次摆放；source + 双镜搭建；视角切换。
- 残留未验：人工目视效果；鼠标 100 次连续摆放（100 次唯一 ID 已在命令层验证）；
  微调后不跳回仅由“吸附只发生在拖动结束”保证，尚无专项 E2E。

## BB-06 测量（已完成，v1 模型）

- `src/physics/measurement.ts`：探测器接收功率/接收比例/局部光斑坐标/入射方向/1/e² 半径；
  圆孔高斯积分（中心解析、偏心数值）；无光/孔外显式 reason；非吸收参考平面测量；
  测量不修改 TraceResult。
- 限制：斜入射椭圆投影未实现，已在 `modelLimits` 声明。

## 侧视/俯视默认再拉远 30%（2026-10-18T11:41）

- 自动取景距离统一乘 1.3，侧视与俯视默认视野更宽松，器件四周留白增加。
- 侧视仍严格水平、台面仍为一条线；俯视 up=-X 与侧视左右顺序不变。
- 自动重新取景（场景变化时）同样使用拉远后的距离。
- 相机 E2E、208 unit、typecheck/lint/build 均通过。

## 侧视/俯视相机自动取景与方向（2026-10-18T11:29）

- 侧视：相机严格水平（camera.y = target.y = 台面高度），台面在画面中投影为一条线；
  根据所有光学头/底座的包围盒自动计算距离，水平方向恰好包含全部光具（14% 余量），
  不再出现过小或漏掉器件。
- 俯视：从侧视绕水平轴旋转 90°，`camera.up = (-X)`，屏幕横向方向与侧视一致
  （Z 增大向画面左侧），所有光具保持同一左右顺序；按 X/Z 尺寸自动取景。
- 进入侧视/俯视后，场景变化（添加/移动/旋转）会自动重新取景；用户手动 Orbit 后
  取消自动取景。重置相机/透视恢复默认 up。
- `cameraState()` 暴露 position/target/up/fov，便于验证。
- E2E 相机测试重写：验证侧视水平、台面成线、所有器件在视口内且横向占比 >35%，
  俯视 up=-X、与侧视左右顺序一致；208 unit / 15 E2E 全绿。

## 光学面材质与通光镜框修复（2026-10-18T11:08）

- 原因：方形镜架背面是整块黑板，前压圈单侧凸起；材质为普通半透明塑料，导致镜片像贴在
  支架一侧、背面漆黑、看不到透光。
- 镜架改为**前后通透的矩形框**（4 根边梁 + 前后两道压圈 + 底部托架），孔径完全开放；
  透镜/BS/波片/法拉第使用圆形光学面。平面镜正面为圆形镜面，背面为深色镜背。
- 材质升级：玻璃使用 `MeshPhysicalMaterial`（transmission/IOR/thickness，depthWrite=false）；
  镜面使用金属材质 + 程序化银色反射纹理；新增 RoomEnvironment + PMREM 环境反射。
- 光束穿过透镜时可见；前后两侧都能看到光学面。
- `visualStats()` 暴露 environment / apertureMounts / glassMaterials / mirrorMaterials；
  `focusElement(type, side, distance)` 可固定视角检查光学面。
- 测试：208 unit / 15 E2E 全绿（新增通光镜框与玻璃/镜面材质 E2E）。

## 模型放大 + 顶栏重置相机 + 精简右侧栏（2026-10-18T10:38）

- 所有光学头/镜架/光源模型从 scale 2 提升到 **3（+50%）**，包括厚度 z 轴；
  立柱高度与底座垂直尺寸重新匹配，光源与光学头仍由立柱支撑，无穿模。
- 右侧删除“视图与变换”分栏；**重置相机**移到顶部视角栏（透视/全景/俯视/前视/侧视
  旁），自动准直仍在调色板顶部。
- 删除“选中器件”里的“旋转（绕竖直轴）”子栏；旋转统一使用底栏“旋转”模式，
  显示环形 gizmo，并支持 Yaw 数字输入。
- 同步修正 `applySelectionScale` / gizmo scale reset / label 初始缩放为 3。
- E2E 更新：模型 scale=3、顶栏重置相机、无“视图与变换/旋转子栏”、底栏 Yaw 输入；
  207 unit / 14 E2E 全绿。

## 修复重复“输出光束参数”面板（2026-10-18T10:24）

- 原因：`refreshSelectedUI` 在重建文件夹时可能被重入，且只销毁最后一次记录的
  `outFolder`；被覆盖的“输出光束参数”文件夹成为 DOM 孤儿，每选中一次就累积一条。
- 修复：
  - 用 `_refreshingSelectedUI` 防重入包装刷新；
  - 每次刷新扫描 `gui.folders`，销毁所有标题为“输出光束参数 / Output Beam
    Characteristics”的旧文件夹，再创建唯一新面板。
- E2E 第 10 项：连续 4 次选中光源始终只有 1 个输出面板；切到透镜仍为 1；点空白为 0。
- 回归：207 unit / 14 Playwright、typecheck/lint/build/docs 全绿。

## 底栏角色化（2026-10-18T10:16）

- 底栏重新保留，并根据选择角色切换：
  - 选中 **底座**：显示底栏与 `X/Y (mm)` 数字输入（分别对应世界 X/Z 水平坐标），
    可输入移动；旋转/缩放按钮隐藏；Z 不参与。
  - 选中 **立柱/光学头**：仅显示 `Z (mm)` 高度输入（对应世界 Y）；“旋转”按钮保留，
    点击后恢复此前的**环形旋转 gizmo**（世界 Y 偏航 + 局部 X 俯仰），并隐藏红蓝高度箭头。
  - 多选：恢复原始平移/旋转/缩放三模式。
- 数字输入会同步立柱高度、底座位置与 scene revision；高度按立柱行程夹紧；
  底座输入不会改变光学高度。
- `__beambench.gizmoState()` 可诊断当前模式与 gizmo 可见性。
- E2E 第 9 项扩展：底座 X/Y 数字输入、头部 Z 高度输入、旋转环形 gizmo 与手柄切换；
  207 unit / 13 E2E 全绿。

## 底座/立柱/光学头分离与角色化手柄（2026-10-18T00:13）

- 模型拆分：光学头（镜架/压圈/旋钮）随器件移动旋转；**底座+立柱是独立场景对象**，
  底座始终贴在台面（y=TABLE_TOP_Y），立柱长度按光学头底部与底座的距离伸缩。
  `headBottomLocal` 记录各头型底部偏移；`updateStand` 将立柱限制在底座与头之间，
  不会伸出底座或戳穿光学头。光源头现在落在立柱上，不再悬空。
- 选择角色：点击底座 → 绿色半透明 XZ 平面手柄（水平移动，保持高度）；点击立柱/
  光学头 → 红/蓝两个垂直箭头（调整高度，底座 xyz 不变）以及“旋转（绕竖直轴）”
  面板（顺/逆时针 15°）。手柄只在最近命中时生效，不会抢光学面的点击。
- 高度范围：根据底座/立柱/头底自动计算并夹紧；拖动越界会被限制。
- 手柄与训练视图互斥：训练模式清除手柄；单选手柄模式隐藏通用 gizmo 工具栏。
- 诊断：`__beambench.selectionRole()`、`selectionHandleInfo()`、`mountInfo()`、
  `selectionHeightLimits()`、`standMetrics()`、`handleDebug()`。
- E2E 第 9 项覆盖底座水平拖动、头部升/降、旋转与“底座不动”；全量 207 unit / 13 E2E。

## 自由摆放 + 自动对齐（2026-10-17T23:34）

- **自由摆放为默认**：25 mm 孔位仅是视觉参考，拖放/移动不再强制吸附；仍限制在
  1.4 m × 1.0 m 台面内，并保留缩小后的底座碰撞检测（半径 9 mm + 1 mm 间隙）。
  `lastPlacement.snapEnabled` 记录本次是否吸附。
- “显示设置”新增 **吸附到孔位** 开关（默认关）；开启后拖放与 gizmo 松开时按 25 mm 吸附。
  API：`__beambench.snapToHoles()` / `setSnapToHoles(bool)`。
- **自动准直**（调色板顶部按钮 + “视图与变换”菜单）：以第一个光源的位置和朝向定义
  光轴，把可对齐的透射器件/探测器中心移到该直线上，并把朝向对齐光源方向；
  反射镜/光栅/阻挡器保持不动（它们用于折转光路）。执行后 push history，可撤销。
  API：`__beambench.autoAlign()` 返回移动数量。
- 训练视图退出保持不变：右上浮动按钮 + `H` / `Esc`，进入时显示提示。
- E2E：自由摆放/可选吸附、自动对齐、训练视图退出；207 unit / 12 Playwright 全绿。

## 器件/镜架选中修复（2026-10-17T23:21）

- 原因：真实镜架/支柱/底座是 visual-only，未进入拾取列表；加入硬件后可见面积最大的是
  镜架，但点击只对薄光学面有效，表现为“放置后无法选中”。
- 修复：`attachHardware(..., attachTarget)` 给每个硬件网格写入所属器件；
  选择射线改用 `_collectPickables()`（碰撞网格 + 源手柄 + 所有硬件网格，动态收集，
  无残留数组）。`_hitTarget` 通过 attachTarget 把镜架/柱/底座映射回所属器件或光源。
- 现在点击光学面、压圈、镜架、支柱、底座、光源外壳均可选中；点击空台面清除选择。
- 新增 `__beambench.selection()` 诊断；E2E 第 7 项覆盖放置后光学面/镜架/底座的选中
  及空白处取消选择。
- 全量回归：207 unit tests、11 项 Playwright、typecheck/lint/build/docs 全绿。

## 光照 / 银灰台面 / 中文界面（2026-10-17T23:13）

- 台面改为银灰铝合金：`MAT_TABLE 0x9fa7b0`、metalness 0.86、roughness 0.32；边框
  `0xc3c9d0`，孔为深灰；配合 ACES tone mapping。
- 光照增强并可调：环境光 1.45、主光 1.9、补光 0.7、轮廓光 0.4；新增“光照”菜单
  （环境光/主光/补光滑杆），默认亮度充足且不过曝。
- 中文界面：`src/upstream/i18n.js` 字典 + lil-gui MutationObserver；控制/光照/显示设置/
  视图与变换/选中器件/操作/输出光束参数、所有主要控件、按钮、调色板、视角按钮与
  3D 器件标签均已中文化；下拉选项使用中文显示、内部值保持英文。
- 证据：`tests/visual/i18n.test.ts` 3 tests；E2E 第 4 项验证调色板/视角/菜单中文；
  截图确认银灰台面与光照。

## 黑屏诊断与启动兜底（2026-10-17T22:55）

- 页面新增 `#boot-status` 启动层：加载中可见；8 秒未初始化或出现脚本/WebGL 错误时
  显示具体原因，不再表现为纯黑。
- WebGL 创建失败时显示“浏览器无法创建 WebGL 上下文”，并提示启用硬件加速/改用
  Chrome/Edge；已用 `--disable-webgl` 实测。
- HUD 显示构建时间；`window.__beambench.build` 同步。新增 `?debug=1` 悬浮诊断：
  build、URL、WebGL renderer、revision、器件数、硬件网格数、台面孔数、训练模式。
- 复测：`file://.../beambench-standalone.html` 正常（revision 1、3 器件、2052 孔）；
  `?debug=1` 输出 WebGL SwiftShader；`?training=1` 正常。
- 仍无法在用户机器复现黑屏；若再现，请提供启动层文字或 `?debug=1` 面板内容。

## CV / 多模态训练场景优化（2026-10-17T22:03）

- `src/upstream/environment.js`：1.4 m × 1.0 m 洞洞板光具台，25 mm M6 孔距，
  2052 个孔用单个 InstancedMesh；含周边框、四条钢腿、脚垫、实验室地面与 1 m 参考网格。
  台面 y=-15.2 mm，光轴位于台面上方；环境不进入 elements/selectable/光线追迹。
- 器件类型色环（`hardware.js`）：lens 蓝、mirror 银、polarizer 绿、waveplate 橙、
  faraday 紫、BS 青、grating 紫、detector 黄、source 红，便于分类与轮廓分割。
- 轮廓线：`Show Contours` / `__beambench.setContours(true)`；按材质亮度自动选择
  深色或亮色 EdgeGeometry 轮廓；训练视图默认开启。
- 训练视图：`?training=1` 或快捷键 `h`，隐藏 palette/HUD/views/lil-gui/选中 gizmo，
  隐藏标签，保留三视角与 Bench 视角；`captureFrame`/bridge capture 可直接取图。
- 相机新增 **Bench** 预设；默认透视保留近距离细节。
- 测试：`tests/visual/environment.test.ts` 3 tests；E2E 第 4 项验证 2052 孔、轮廓 >10、
  UI 隐藏与 1280×720 非空截图。

## Thorlabs 风格硬件建模（2026-10-17T20:18）

- `src/upstream/hardware.js`：程序化光学机械件——黑色阳极氧化底板/镜架、前压圈、
  黄铜调节旋钮、钢柱、柱座、紧定螺钉、底座螺钉；偏振片/波片/法拉第使用带刻度的
  旋转架；激光源使用激光头壳体；探测器/光阑使用专用头。
- 接入方式：`addElement()` 与 `Sources.addSource()` 自动挂载；作为碰撞网格的子节点，
  随摆放/旋转/缩放移动，但不进入 `elements`/`selectable`，不参与光线追迹。
- 几何/材质共享缓存，3 个默认器件共 33 个硬件网格；`__beambench.hardwareStats()` 可查询。
- 证据：`tests/visual/hardware.test.ts`（5 tests）、E2E 第 4 项（新增镜架计数 +1）。
- 限制：外观为程序化近似，不是 CAD 精确件号/尺寸；不替代真实 Thorlabs 模型库。

## BB-07 BB84 事件采样（已完成）

- `src/qkd/bb84.ts`：H/V/D/A 四通道；Alice/Bob 随机基；损耗、探测效率、暗计数、
  双击丢弃、基失配丢弃；sifted key、QBER、gain、每端口计数。
- `clickProbabilities()` 精确闭合：noClick + 单击 + 多击 = 1（≤1e-8）。
- 版本化 PRNG `mulberry32-v1`；结果对 seed 可复现。
- `Bb84Runner` 按 `engineCommit:prng:opticalHash:pulses:seed` 缓存并自动失效；有界 32 条。
- `scenarios/bb84.json`；证据 17 tests（lossless/lossy/15° 失配/暗计数/缓存/确定性）。

## BB-08 准直基线（已完成）

- `src/alignment/baseline.ts`：场景校验、解析；有限差分 Jacobian + 阻尼最小二乘；
  控制量限幅、步长上限、显式终止状态（CONVERGED/MAX_ITERATIONS/UNREACHABLE/NO_IMPROVEMENT）。
- `runAlignmentBaseline()` 对 20 个 seed 注入确定性扰动；两镜与准直场景全部收敛；
  不可达目标全部失败且不越界；fixture 不被修改。
- 场景文件：`scenarios/two-mirror.json`、`scenarios/collimation.json`。
- 限制：v1 为近轴解析模型，不含真实光线追迹/q 传播；已在文件头声明。

## BB-09/10/11/12 读写集成（已接线）

- `src/integration/upstream-scene.ts`：把上游 elements/sources/camera 映射为通过校验的
  SceneV1（type/props/quaternion 归一化、未知类型跳过、稳定 UUID）。
- `src/integration/scene-mirror.ts`：读路径镜像（get_state/observe/save_scene/capture）。
- `src/integration/ui-commands.ts`：写路径执行器；add/remove/setPose/setParam/undo/redo
  经 UI 适配器应用到 Three.js 场景；命令期间抑制中间 sync，保证每次命令 revision 只 +1。
- `src/upstream/main.js`：`uiActions` 把域命令翻译成 make*/Sources/State 操作；
  UUID 写入 `props.__bbUuid` 并经 State 历史保留，undo/redo 后身份稳定。
- 写命令支持：add/remove/setPose/setParam/setDof/load_scene/reset/undo/redo。
- `setDof` 把机械限位写入 `props.__bbMount` 并经状态历史持久化；`load_scene` 先完整校验
  再重建 UI；`reset` 生成空场景并保留 seed。移除了上游“无源时自动创建隐式源”的行为。
- `run_bb84` 已接入：固定 revision 运行、Bb84Runner 缓存、返回 engineCommit/opticalHash/sceneRevision。
- 浏览器 E2E：读路径（握手/get_state/observe/capture/save_scene/run_bb84/STALE/PNG 解码）；
  写路径（add→setPose→setParam→undo/redo→remove→setDof→reset→load_scene，UUID 稳定）；
  探测器读数（宿主添加 source+detector → observe hit、receivedRatio）；
  agent 假策略回放（add → capture → stop，记录无 token/提示词）。
- `src/agent/host-environment.ts`：把 SDK/MessagePort 客户端适配为 AgentEnvironment。
- `examples/host/`：同源 iframe + SDK 示例。
- **未验**：真实 agent 模型、浏览器 FPS/P95、setDof/load_scene/reset 的 UI 写入。

## 打开方式与单文件构建（2026-10-17T19:39）

- 直接双击普通 HTML 会黑屏：浏览器禁止 `file://` 加载 ES module（已复现：
  CORS 阻止 `src/upstream/main.js` / `dist/assets/*.js`）。
- 普通构建被 file:// 打开时显示中文提示层，指出应使用 dev/preview/单文件版。
- `npm run build:standalone`：把无 import 的生产 bundle 内联为经典脚本，放到
  `</body>` 前，输出 `dist/beambench-standalone.html`（0.66 MiB）。
- file:// 单文件验证：revision 1、3 个器件、无 pageerror；bridge `capture` 不可用
  （file origin），新增 `__beambench.captureFrame(view)` 诊断接口；截图为 1280×720、
  62,747 bytes、采样 43 种颜色，确认非黑屏。

## 冷安装验证（BB-AC10，2026-10-17T18:58）

- 新临时目录 `npm ci`、`typecheck`、`build`、`test:unit:run`（166）全部 exit 0；
  `npm run preview` 对 `/beambench.html` 返回 200；`dist/beambench.html` 远程引用 0。
- 证据：`docs/COLD_INSTALL.md`；`NOTICE` 记录上游 SHA、补丁与第三方许可。
- 未验：冷目录中的 E2E（Playwright 浏览器为用户级缓存）；发行归档。

## 已知限制 / 风险

- 上游 `clampToPlaneXZ()` 会清除 source roll；workaround：roll≈0（BB-01 记录）。
- 鼠标/检查器编辑仍直接改上游对象，然后经快照推进 revision；宿主写命令走
  UiCommandExecutor 再落到 UI。两条路径已收敛到同一 revision，但还不是“所有编辑都
  发命令”的单一管线。
- 演示场景中的镜面 z=0.135 不在 25 mm 孔位上；仅影响演示初始布局。
- 浏览器使用 Playwright Chromium headless；真实 GPU/交互手感未验。

## 下一步

1. 把 spawn/gizmo/inspector/delete 也改为发命令（彻底单一管线）。
2. 在真实 GPU 机器上重跑 BB-13（当前环境 SwiftShader → BLOCKED_ENV）。
3. 接入 `run_bb84`、准直场景与浏览器探测器读数 E2E。
4. 真实模型评测明确标注未验。

本工作区不是 Git 仓库；没有提交记录。
