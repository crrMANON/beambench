# BeamBench 分阶段执行任务

本文只维护任务输入、输出和执行条件；产品标准引用PLAN的AC，不复制。所有任务当前均为NOT_STARTED，真实状态见STATUS。下述源码/测试路径是拟建路径，命令在BB-00建立工程入口后方可运行。每项任务仅有一个主要交付目标；验证失败不得设DONE。

## 依赖与集成规则

```text
BB-00 → BB-01 → BB-02 → BB-03
BB-03 → BB-04 → BB-06
BB-03 → BB-05
BB-05 + BB-06 → BB-07 / BB-08
BB-03 + BB-07 + BB-08 → BB-09
BB-04 + BB-05 + BB-07 + BB-08 → BB-10
BB-08 + BB-09 + BB-10 → BB-11
BB-05 + BB-07 + BB-08 + BB-09 + BB-10 + BB-11 → BB-12 → BB-13 → BB-14
```

DAG中的线只是摘要；每项“依赖”是唯一权威。集成负责人拥有上游关键文件、schema、package/lock、应用装配入口、STATUS和HANDOFF；其他Agent不得并行修改这些文件。每个并行任务交付独立目录和测试，由集成负责人按依赖顺序合并、跑双方接口测试、检查冲突；合并成功才推进Gate。阶段验收后依实际提交/测试更新STATUS并替换HANDOFF。任务依赖包含前一阶段Gate所需汇合，不得仅因单一接口就提前跨Gate开发。

## P0：可复现性与风险PoC

### BB-00 — 建立可复现的上游运行基线

- 主要目标：让锁定的上游在本项目内可离线构建运行；依赖：无。
- 输入/阅读：RESEARCH中的SHA、上游beambench.html/main.js、license；本机Node/npm。
- 修改/所有权：`src/upstream/`、应用入口、package.json/package-lock.json、vite配置、来源清单；集成负责人独占。
- 步骤：集成负责人检查Phys-lab根版本控制，若无仓库则在根初始化一次，两路线共用且不建嵌套仓库；导入固定SHA并记来源；npm安装上游相同three/lil-gui；去CDN/importmap缓存版本串；选择兼容Vite/TS/Vitest/Playwright并锁定；保留JS以allowJs渐进包装；建立lint/typecheck/unit/build/docs检查入口；固定验收机/浏览器。
- 输出：可运行本地页面、锁文件、原版外观截图、工具版本和依赖清单；不交付新物理功能。
- 验收：构建后的页面在断外网时载入，WebGL绘出默认光源/器件；无远程资源；所有版本可复查。
- 验证：`npm ci`、`npm run typecheck`、`npm run build`、`npx playwright test tests/e2e/upstream-smoke.spec.ts`；截图与控制台/网络日志留artifact。
- 风险：新工具默认版本要求改变/模块查询串；兼容失败先保留JS和旧three，不顺带升级引擎。
- 并行：否；文档：补RESEARCH运行证据、依赖矩阵和DECISIONS的版本记录；阶段未过不推进。

### BB-01 — 证明非共面传播和偏振可用于实验

- 主要目标：确定并修复最小3D物理可行性；依赖：BB-00。
- 输入/阅读：`beam-frame.js`、`propagation.js`、`elements.js`、`sources.js`；独立反射/Jones公式。
- 修改/所有权：上游计算局部补丁、`tests/physics/three-dimensional.test.ts`；单一物理负责人，入口改动交集成者。
- 步骤：构建源roll、非零高度和两次非共面反射fixture；记录重算前后位姿/基；比较独立公式；仅修清roll/基变换/变换矩阵更新的失败点；记录适用模型限制。
- 输出：最小可行性报告、可重现fixture及局部补丁；不能以漂亮截图代替数学结果。
- 验收：读/追迹不改源位姿，3D反射方向/偏振/功率满足BB-AC03和PLAN数值容差；未证明的情况列明。
- 验证：`npm run test:unit -- --run tests/physics/three-dimensional.test.ts`及BB-00冒烟；报告expected来源。
- 风险：单q近轴不能覆盖任意离轴像散；最多2人日PoC，无局部可行修复则停止并提ADR。
- 并行：否；文档：RESEARCH补事实/限制，DECISIONS记录修复边界，P0 Gate更新STATUS/HANDOFF。

## P1：单一状态与命令

### BB-02 — 实现版本化场景状态与持久化

- 主要目标：建立场景唯一来源及无损往返；依赖：BB-01。
- 输入/阅读：PLAN §3.1、上游state.js的capture/restore和原有JSON样本。
- 修改/所有权：`src/domain/scene.ts`、`scene-io.ts`、fixtures/schema；集成负责人拥有类型导出。
- 步骤：定义SceneV1和元件判别类型；校验有限数/UUID/四元数/引用；分离光学与视觉状态；实现先验证再load、legacy导入、50步undo/redo；Three.js对象只作为状态投影。
- 输出：状态类型、JSON读写及迁移fixture；无文件对话框耦合。
- 验收：BB-AC02；坏schema、重复ID、NaN/非法引用不替换现有状态；roundtrip稳定。
- 验证：`npm run test:unit -- --run tests/domain/scene-io.test.ts`，旧JSON导入后再导出对比。
- 风险：上游state恢复有setTimeout与隐式上下文；以适配层替换入口，不整体重写UI。
- 并行：否；文档：数据字段与兼容限制更新到PLAN/必要schema说明，不重复复制类型。

### BB-03 — 实现原子且可幂等的命令执行器

- 主要目标：统一鼠标和AI操作的提交语义；依赖：BB-02。
- 输入/阅读：SceneV1、PLAN §3.2、上游doRecompute异步逻辑。
- 修改/所有权：`src/domain/commands.ts`、应用装配入口；集成负责人独占共享写入口。
- 步骤：实现受限命令/校验/expectedRevision；候选状态重算成功才提交；有界串行队列和请求ID缓存；鼠标拖动临时预览松手提交；失败不改历史。
- 输出：execute/get_state/observe内部服务及契约fixture。
- 验收：同命令两入口结果一致；失败/过期/重复不产生额外revision；并发写按序完成；读取不看到中间结果。
- 验证：`npm run test:unit -- --run tests/domain/commands.test.ts`；注入重算失败和乱序Promise完成。
- 风险：上游回调绕过状态；检索所有位置/参数写入口逐一接入，不允许双状态长期共存。
- 并行：否；文档：记录错误码/命令契约；P1 Gate更新STATUS/HANDOFF。

## P2：物理、机械交互和测量

### BB-04 — 提供可审计的光学传播结果

- 主要目标：稳定输出完整TraceResult而非只画光线；依赖：BB-03。
- 输入/阅读：已验证计算模块、PLAN §3.1/3.3、上游幅度截断/路径队列。
- 修改/所有权：`src/physics/trace.ts`、上游propagation结果接点、`tests/physics/trace.test.ts`；物理负责人独占上游文件。
- 步骤：保留数学/求交实现，抽出结果收集接口；禁止隐式源和默认反向源；输出全部分支/损失/截断；统一Jones基及光学面；建立解析golden fixtures。
- 输出：deterministic TraceResult、局部补丁和模型限制表；不重做编辑UI。
- 验收：BB-AC03；无损总功率残差≤1e-8；截断有显式状态；连续读取不改场景；装饰物不影响结果。
- 验证：`npm run test:unit -- --run tests/physics/trace.test.ts`及BB-01回归，含循环路径与多分束。
- 风险：幅度阈值丢弱支路、渲染资源依赖；先旁路结果输出，不引入新物理引擎。
- 并行：可与BB-05并行，禁止共享propagation/装配入口；文档：记录模型限制、结果字段/补丁。

### BB-05 — 实现光具台上的鼠标摆放和机械自由度

- 主要目标：提供有约束的人工搭建操作；依赖：BB-03。
- 输入/阅读：SceneV1/Command契约、现有gizmo和drag/drop。
- 修改/所有权：`src/interaction/`、`src/render/hardware.ts`、相应E2E；装配接线交集成者。
- 步骤：建程序化台面/支架/底座；25mm孔位吸附和粗调高度；分离basePose与tip/tilt；去任意缩放；越界/底座重叠检测；3视角UI。
- 输出：可手动摆放和微调的实验编辑器。
- 验收：BB-AC01；100次摆放/移除无重复ID；粗调后微调不跳回；视觉几何不进入光学集合。
- 验证：`npx playwright test tests/e2e/bench-interaction.spec.ts`，人工从空台摆放源/双镜；不只调用API代替鼠标操作。
- 风险：孔位吸附影响光学位置、相机和拖动冲突；预览与提交分离。
- 并行：可与BB-04并行；文档：操作说明、支持型号/自由度更新。

### BB-06 — 实现探测器与非吸收参考平面的测量

- 主要目标：得到可用于准直的量化Observation；依赖：BB-04。
- 输入/阅读：TraceResult、探测器有限孔径定义、参考平面局部基。
- 修改/所有权：`src/physics/measurement.ts`、`tests/physics/measurement.test.ts`；不改UI和命令协议。
- 步骤：求主光束与非吸收参考平面交点；圆孔居中解析/偏心数值积分；报告入射方向/束宽/q/接收功率；生成探测器伪彩图；区分未命中/截断/模型不支持。
- 输出：Observation及测量fixture。
- 验收：BB-AC04；接收率绝对误差≤1e-4；两平面测量不改变TraceResult；位姿改变读数跟随。
- 验证：`npm run test:unit -- --run tests/physics/measurement.test.ts`，用独立高分辨积分和解析例校对。
- 风险：拿中心命中替代有限光斑、斜入射模型越界；超范围返回原因。
- 并行：可与BB-05尾段并行，仅修改独立测量文件；文档：测量定义/容差和限制；P2 Gate验04/05/06。

## P3：实验算法

### BB-07 — 实现偏振BB84事件采样

- 主要目标：从真实四通道光学传递产生协议统计；依赖：BB-05、BB-06。
- 输入/阅读：PLAN §3.3、4种编码传递概率、测量契约。
- 修改/所有权：`src/qkd/`、`scenarios/bb84.json`、`tests/qkd/`；不得修改physics模块。
- 步骤：建立4通道场景；确定端口/比特约定；验证每种态传递；加入版本化PRNG、无点击/暗计数/双击丢弃；缓存按光学hash和引擎版本失效；实现run_bb84。
- 输出：BB84场景、纯采样模块和统计报告格式。
- 验收：BB-AC05；概率和≤1+1e-8，无损/损耗分别正确；光学改变后不使用旧缓存。
- 验证：`npm run test:unit -- --run tests/qkd/bb84.test.ts`及`npx playwright test tests/e2e/bb84-scene.spec.ts`；统计fixture固定seed。
- 风险：对损耗归一化、PBS端口反置、经典强度冒称光子；测试失败回到光学传递不调整统计阈值。
- 并行：可与BB-08，目录不重叠；文档：端口/比特、统计分母、模型限制。

### BB-08 — 实现可复现的准直训练基线

- 主要目标：证明对齐/光束准直任务在既定操作范围可解；依赖：BB-05、BB-06。
- 输入/阅读：Observation、镜架自由度、PLAN §3.3目标。
- 修改/所有权：`src/alignment/`、`scenarios/two-mirror.json`和`collimation.json`、相应测试。
- 步骤：建立非吸收双平面场景与可达目标；注入固定扰动；有限差分影响矩阵、秩检查、阻尼/步长限制；独立透镜q目标求解；实现不可达/无改善退出。
- 输出：两个场景、确定性基线、20种子结果。
- 验收：BB-AC06；所有指定种子成功；不可达fixture正确失败；基线不能改源/目标。
- 验证：`npm run test:unit -- --run tests/alignment/baseline.test.ts`；输出每步残差和终止原因。
- 风险：两平面不独立或矩阵病态；修fixture几何/数值而不放宽产品门槛。
- 并行：可与BB-07；文档：记录目标、可达域、扰动定义；P3 Gate验07/08。

## P4：宿主与AI

### BB-09 — 实现受限宿主桥与SDK

- 主要目标：让现有系统以稳定协议操作实验；依赖：BB-03、BB-07、BB-08。
- 输入/阅读：冻结命令契约和Origin/MessageChannel约束。
- 修改/所有权：`src/bridge/`、`examples/host/`、桥接契约及E2E。
- 步骤：来源校验和握手；MessagePort RPC；请求校验/大小/重试；提供超时和重连语义；SDK不执行页面脚本。
- 输出：可嵌入iframe、最小宿主及调用示例。
- 验收：BB-AC07中协议部分；错误来源/旧版本/重复请求拒绝或幂等；无远程CDN。
- 验证：`npx playwright test tests/e2e/host-bridge.spec.ts`，使用两个本地origin和恶意消息fixture。
- 风险：跨域误设通配、读写超时混淆；固定错误码，失败不隐藏。
- 并行：可与BB-10，公共契约只由集成者改；P4 Gate前不得跳过P3；文档：SDK接入/安全配置。

### BB-10 — 实现同版本画面捕获

- 主要目标：保证AI看到的画面与测量同一状态；依赖：BB-04、BB-05、BB-07、BB-08。
- 输入/阅读：revision、三视角相机、Three.js渲染生命周期。
- 修改/所有权：`src/render/capture.ts`、截图契约测试；不改桥握手。
- 步骤：目标revision稳定后显式render并toBlob；输出PNG与view/frameId/revision；捕捉中版本变更拒绝；检测空图/尺寸限制；释放Blob URL和渲染资源。
- 输出：capture方法及3视角示例。
- 验收：BB-AC07截图部分；图像可解码且有器件/光路；帧与Observation版本一致；不改变物理。
- 验证：`npx playwright test tests/e2e/capture.spec.ts`，含捕捉时修改场景、100次捕捉资源回收。
- 风险：WebGL空画布、相机缓存过期；显式render，不默认全局preserveDrawingBuffer。
- 并行：可与BB-09；文档：截图语义、大小/失败定义。

### BB-11 — 实现有预算且可回放的AI实验循环

- 主要目标：得到可检查、可终止的agent工作流；依赖：BB-08、BB-09、BB-10。
- 输入/阅读：SDK、同版截图/观测、RunRecord和任务可调自由度。
- 修改/所有权：`src/agent/`、`examples/agent/`、假策略与回放测试。
- 步骤：注入策略函数；执行observe/capture/act循环；限制目标/器件/步数/无改善；固定seed并记录实际执行值/帧引用；确定性策略回放；真实模型仅可配置时另测。
- 输出：agent runner、日志导出、失败/终止原因、20回合评测脚本。
- 验收：BB-AC08；不允许改目标或源作弊；同输入假策略完全重放；真实模型缺失明确标未验。
- 验证：`npm run test:unit -- --run tests/agent/runner.test.ts`及`npx playwright test tests/e2e/agent-replay.spec.ts`。
- 风险：把基线当AI能力、日志泄凭据、无限工具调用；区分baseline/agent报告并硬限制预算。
- 并行：否；文档：agent接入、模型信息、日志与停止规则；P4 Gate更新STATUS/HANDOFF。

## P5：集成、性能、发布

### BB-12 — 验证完整用户流程的集成正确性

- 主要目标：证明子系统组合符合产品AC；依赖：BB-05、BB-07、BB-08、BB-09、BB-10、BB-11。
- 输入/阅读：各任务证据、三个fixture、宿主和agent示例。
- 修改/所有权：`tests/e2e/acceptance.spec.ts`和缺陷最小修复；集成负责人。
- 步骤：真实鼠标搭建/保存/重载；宿主调用BB84；扰动后agent彩排；注入stale/坏文件/截断；人工检查三视角。
- 输出：AC01–08可追溯集成报告和缺陷清单。
- 验收：所有目标AC无失败/关键skip；实际鼠标行为和API等价；每个断言关联AC ID。
- 验证：全量`npm run lint`、`npm run typecheck`、`npm run test:unit -- --run`、`npm run build`、`npx playwright test`。
- 风险：只测假API忽略浏览器实际错误；必须真实WebGL和宿主。
- 并行：否；文档：STATUS真实缺陷/证据，HANDOFF下一步性能。

### BB-13 — 验证并优化验收负载的性能

- 主要目标：满足BB-AC09；依赖：BB-12。
- 输入/阅读：固定验收机/浏览器与负载，集成报告。
- 修改/所有权：`tools/benchmark.ts`、`tests/perf/`；必要资源dispose/批量刷新局部修复。
- 步骤：记录原始FPS/延迟/内存；定位重算/渲染/资源泄漏；做最小优化并重跑相关物理/画面回归；不先引入worker。
- 输出：带原始样本和环境的性能报告。
- 验收：AC09全部通过，失败项明确未完成；不以降低样本/段数冒充通过。
- 验证：`npm run test:perf -- --fixture acceptance-v1 --seed 42`，记录前后结果并复跑BB-12影响集。
- 风险：软渲染/开发模式导致无效数据；报告机器/GPU，缺资源记BLOCKED_ENV。
- 并行：否；文档：性能证据/资源限制；架构变更需DECISIONS。

### BB-14 — 交付可从干净环境复现的发行包

- 主要目标：形成可安装、可接手的交付；依赖：BB-13。
- 输入/阅读：完整AC证据、lock/license、已知问题。
- 修改/所有权：发行/启动脚本、README、NOTICE、docs；集成负责人。
- 步骤：干净目录安装构建并演示；核对来源/补丁/锁文件；检查文档路径/任务依赖；归档证据；移除过时交接内容。
- 输出：源码发行与启动手册、验收索引、最终STATUS/HANDOFF。
- 验收：BB-AC10；无P0/P1缺陷；AC01–09证据可访问；真实模型/宿主未验范围明确。
- 验证：冷启动执行PLAN全部命令和`npm run verify:docs`，人工搭建及准直演示；不只验证本机热缓存。
- 风险：忽略GPL来源或把未验功能写进README；发布前逐条比对实际支持范围。
- 并行：否；文档：PLAN仅必要偏差、STATUS最终事实、HANDOFF维护起点；P5 Gate签收。
