# 几何光学与高斯光束库完成记录

日期：2026-10-24。关联[实施计划](../plans/2026-10-24-expand-optics-libraries.md)。Process Hub未启用，采用普通项目文档。

## 实际交付

- 版本1.1.0。新增几何光学库8项、高斯光束库5项及6个原格式示例；保留偏振库7项，安装目录中偏振库的6个文件哈希全部不变。
- API 1开放原生lens、thickLens、mirror工厂，校验焦距、曲率、折射率、厚度等参数；修正曲面镜在程序创建和SceneV1恢复中的参数映射。全部复用原版工厂、模型和传播算法。
- 打包工具支持全部打包或按库打包；两个独立ZIP实际解压安装到本地optics-libraries。独立安装、共存及分别卸载后重建均通过隔离矩阵验证。接入方式仍为安装目录后重新构建，不是网页内下载或热加载。
- [基础版](../../dist-basic/beambench-standalone.html)共26项，[默认版](../../dist/beambench-standalone.html)共30项。条目沿用原版样式，以“几何·”“高斯·”区分。没有改布局、场景、光照、材质或模型，没有新增光阑。
- [几何光学ZIP](../../release/geometric-optics-1.0.0.zip)、[高斯光束ZIP](../../release/gaussian-beams-1.0.0.zip)，均含清单、完整许可证、说明及3个实验示例；ZIP CRC核验通过。示例需通过原有加载场景功能手动打开。
- 更新[接口与安装说明](../OPTICS_LIBRARIES.md)、README、NOTICE、打包工具、构建验证工具及针对性测试。高斯示例说明有限束腰和近似倍率的适用条件。

## 验证与边界

- 22个测试文件、259项测试全部通过。新增32项测试覆盖13个预设逐项创建、参数往返、原生保存加载和撤销重做，以及透镜、厚透镜、曲面镜的光线方向与高斯ABCD结果。扩束示例在原生传播路径中功率保持1，束半径约4mm；近似准直示例的发散降低符合断言。
- typecheck、lint、verify:docs、默认构建及基础构建通过。Vite仍有大bundle提示。
- 12种隔离构建状态通过：无库、偏振库、新库各自安装、全部共存、分别卸载及卸载后重装；非法API拒绝和单文件脚本语法检查通过。
- 12个受保护原版文件及入口中2个场景/交互区域保持原始哈希一致。Playwright默认headless shell中原版/当前无库版截图逐像素对照通过，只统一构建时间文字，没有修改原版基准。
- 本机Chrome中两项功能用例通过：偏振QWP真实拖拽、保存、撤销重做、卸载后读档；三库26/30项及5个代表新增预设的同类交互。全部13项的参数和历史行为另有原生单元覆盖。
- 浏览器测试曾受沙箱启动权限限制，获准后在独立浏览器环境执行；headless shell的多器件交互超过120秒，改用本机Chrome后通过。本机Chrome严格截图对照仍失败：1440×1000截图中2个像素各有最大1/255的通道差异。保留截图和失败日志，不声称所有浏览器整套测试全绿，也没有放宽像素断言。
- 未运行完整历史E2E、性能基准及冷安装。本次没有自动更新GitHub；远端保留扩充前检查点eb2d66c，新增库及构建当前仅在本地。

## 证据与复现

[核验清单与ZIP校验和](../../artifacts/expand-optics-20261024/final-verification.json)、[单元测试](../../artifacts/expand-optics-20261024/unit.log)、[构建矩阵](../../artifacts/expand-optics-20261024/build-matrix.log)、[默认浏览器截图通过记录](../../artifacts/expand-optics-20261024/browser-rerun.log)、[Chrome功能通过及截图差异记录](../../artifacts/expand-optics-20261024/browser-accepted.log)。Chrome对照图另存chrome-original.png、chrome-current.png和chrome-visual-diff.png。

复现：先运行npm run verify:optics生成隔离工程，再运行npm run test:optics:browser。可通过BB_BROWSER_CHANNEL=chrome选择本机Chrome；不同渲染器的精确截图结果见上述边界。安装新库后运行npm run build:basic，重新打开dist-basic/beambench-standalone.html即可查看。
