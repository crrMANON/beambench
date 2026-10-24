# BeamBench 调查证据与限制

调查日期：2026-10-17（Asia/Shanghai）。方式：阅读本项目既有计划，Tavily Search/Extract检索与提取，Git浅克隆上游到临时目录后直接检查源码；不依赖搜索摘要断言接口存在。初稿已提供开源候选比较，本轮聚焦所选路线的实现风险。

## 已确认事实

| 编号 | 事实 | 证据与边界 |
|---|---|---|
| BF01 | 项目当前只有两条路线的计划资料，没有产品源码 | 本项目文件清单；不得把本次文档扩写当实现 |
| BF02 | 上游调查SHA为`47686d611b7b11121cfaf7be0583aee6ac34e9b0` | git clone与rev-parse成功；临时位置`/private/tmp/phys-lab-research-beambench-20261017`，该路径非交付依赖 |
| BF03 | 上游是静态ESM应用，无package.json、测试或构建CI | `rg --files`，.github仅FUNDING；JS约5674行；未核实其他分支是否有测试 |
| BF04 | 实际版本为Three.js 0.161.0、lil-gui 0.18 | HTML importmap与main.js远程import；需本地化锁依赖 |
| BF05 | 支持鼠标拖入、gizmo、JSON保存和undo/redo | main.js palette/drop、gizmo-ui.js、state.js；运行行为尚未浏览器实测 |
| BF06 | clampToPlaneXZ不锁高度，但将源Euler roll清0 | elements.js函数设置rotation(e.x,e.y,0)，propagation.js每次seed源调用；不能把函数名字当作完整行为说明 |
| BF07 | 传播有3D求交和局部Jones基代码，并和画线/缓存耦合 | propagation.js recompute、reflectJonesWithBasis、Raycaster、ribbon更新；已有实现不等于全模型正确 |
| BF08 | 有AMP_CUTOFF=0.02、MAX_BEAMS=600与路径步数限制 | propagation.js；弱支路可能被丢，需显式预算/截断，不可无条件用结果做概率 |
| BF09 | 无源时自动加临时源，支持双向源 | propagation.js activeSources与forward/backward seed；实验模式需显式关闭隐式行为 |
| BF10 | GPL-3.0-or-later | LICENSE与源文件SPDX；用户已接受该路线的分发条件 |
| BF11 | 本机arm64、macOS27.0.1、Node24.18.0、npm11.16.0、Python3.12.3，Chrome已安装 | uname/sw_vers/version/Applications清单；没有运行WebGL或浏览器性能测试 |
| BF12 | Vite官方当前指南要求Node20.19+/22.12+，提供vanilla-ts | Tavily实际提取官方页面成功；不能据此宣称未来安装的任何插件版本均兼容 |

本轮仅执行以下两个数学冒烟断言，Node退出码0：

```text
PASS: ABCD free-space q and Jones norm smoke checks (2); not a scene/physics certification
```

方法：从该SHA的optics.js原文通过Node data URL载入；断言`abcd(i,1,0.3,0,1)=0.3+i`及`jNorm([1,0])=1`，容差1e-12。无DOM/Three.js场景，无鼠标、WebGL、非共面反射或QKD端到端；不能将此扩写为物理认证或项目验收通过。

## 合理推断（非运行事实）

- I01：保留已有3D编辑器和数学模块，比从零建立编辑器更符合当前范围；仍需BB-00/01证实可运行及局部修复规模。
- I02：光源roll被重算清除会破坏任意姿态/偏振表达；具体影响必须用独立公式fixture证明，不能仅凭静态代码断言所有光路错误。
- I03：显示/物理混合和默认幅度截断是Agent读数接口的主要改造点；优先补结果输出，不授权全面重构。
- I04：30器件/100段规模可能用单主线程满足，但没有性能数据；worker不进入默认架构。

## 待验证事项

| 编号 | 验证问题 | 负责任务 |
|---|---|---|
| BU01 | 本地打包、无CDN、真实Chrome/WebGL能运行 | BB-00 |
| BU02 | 非共面反射、源roll和Jones基的正确性/只读不变性 | BB-01 |
| BU03 | 上游保存格式迁移、稳定ID和时序更新语义 | BB-02/03 |
| BU04 | 分支概率、有限孔径、q近轴限制与测量精度 | BB-04/06 |
| BU05 | 三场景可达性、BB84数值和准直20种子表现 | BB-07/08 |
| BU06 | 实际宿主接入、截图时序、AI模型效果 | BB-09/10/11 |
| BU07 | 验收机帧率/内存/操作P95、冷启动 | BB-13/14 |

本轮没有npm安装或浏览器交互，不得填写这些测试“通过”。未来Vite/TypeScript/Vitest/Playwright精确版本由BB-00实装核实并锁定，不猜版本号。

## 需要用户决策的问题

当前没有阻塞计划编写的新决策：网页、BB84、视觉+结构化和GPL已确认。需在对应Gate前补充的外部输入：实际宿主origin/接口约束、验收机器、真实模型ID/凭据/调用预算；缺失时仅能验示例宿主和假策略。若PoC证明需要换引擎、降验收规模、增加后端或改变许可证，必须提供失败证据与ADR后请用户决定，不能先实施。

## 可复查来源

- [固定SHA源码](https://github.com/visuphy/BeamBench/tree/47686d611b7b11121cfaf7be0583aee6ac34e9b0)
- [实际依赖importmap](https://github.com/visuphy/BeamBench/blob/47686d611b7b11121cfaf7be0583aee6ac34e9b0/beambench.html)
- [传播/源约束/截断](https://github.com/visuphy/BeamBench/blob/47686d611b7b11121cfaf7be0583aee6ac34e9b0/propagation.js)
- [变换约束](https://github.com/visuphy/BeamBench/blob/47686d611b7b11121cfaf7be0583aee6ac34e9b0/elements.js)
- [保存恢复](https://github.com/visuphy/BeamBench/blob/47686d611b7b11121cfaf7be0583aee6ac34e9b0/state.js)
- [Vite官方指南](https://vite.dev/guide/)、[Playwright官方安装/运行指南](https://playwright.dev/docs/intro)（本轮Tavily Extract均成功）
