# 原版模块化光具库第一阶段完成记录

日期：2026-10-24。关联[实施前计划](../plans/2026-10-24-modular-optics-v1.md)。Process Hub未启用，采用普通项目文档。

## 实际改动

- 新增数据型API 1光具库接口：扫描optics-libraries/直接子目录，校验清单、接口版本、ID冲突和原生参数；只嵌入JSON，不执行库代码、不从网络加载外部库。
- 原入口仅增加光具栏挂接和原生预设创建，保留原版创建分支、拖拽、支架、参数面板、保存加载与历史机制。程序创建和SceneV1恢复路径保留QWP的type/delta、PBS配置以及0度旋光值。没有引入SceneV2。
- 默认10条原版器件保留；基础配置6条，通过build:basic输出到dist-basic/，不覆盖dist/。新增optics-build.json记录实际配置和安装库。两种当前根目录产物均未默认安装偏振库。
- 独立偏振库包含7个预设、许可证、安装说明、3个原版格式的实验场景。源包与安装目录分开，可从ZIP安装、移除后重新构建。由于仍使用原生类型，已保存场景不依赖库继续安装。
- 新增光具库构建矩阵、原版视觉冻结检查、原生Jones实验与保存/加载/撤销测试，以及独立浏览器套件和固定原版压缩基准。发布工具包含新增接口、示范库和测试配置。
- [用户说明](../OPTICS_LIBRARIES.md)、[偏振源包](../../library-packages/polarization/)、[偏振ZIP](../../release/polarization-1.0.0.zip)。没有上传或发布GitHub，没有处理Git元数据迁移，也没有创建新提交。

## 验证结果

- 实施前原版20文件/208测试通过。实施后21文件/227测试通过，包含马吕斯定律、HWP、QWP、圆偏振分析器角度独立性、原生保存加载和撤销重做。
- 新增物理测试初次运行出现4项NaN断言失败，原因是测试导入未使用原版模块的查询版本，导致Complex类身份不一致。修正测试导入后全部通过；没有修改原版物理代码。
- typecheck、lint、verify:docs、默认单文件构建、基础配置构建均通过。
- 隔离工程中从真实ZIP安装，构建original-empty、basic-empty、original-installed、basic-installed、basic-removed五种状态，元数据和单文件经典脚本语法均通过；非法API版本被构建明确拒绝。不修改实际安装目录。
- 12个原版文件（含HTML/CSS、环境、模型、材质、历史、传播、域类型等）逐字节哈希保持一致；入口中场景/相机/光照相关区域及原有交互与默认演示段保持一致。原版图形和物理文件没有重绘或替换。
- 真实Chrome打开原版、修改后的默认版及安装库的基础版：默认版仍10条，基础安装版13条；环境光1.45、主光1.9、补光0.7保持原值，场景和面板人工对照未见额外变化。工具会话中的截图仅作人工观察，不等同于像素比较通过。
- 两项Playwright浏览器测试均在启动Chromium时被系统MachPort权限拒绝（0ms、尚未执行断言）。自动截图像素比较和真实拖拽/浏览器文件加载及撤销流程尚未验收；不能以单元测试替代这一结论。未绕过系统保护，也未修改基准掩盖失败。
- 发行打包成功，包内121项校验和核对通过，独立偏振ZIP完整性通过。Vite仍有原版已有的大bundle警告，public空目录被打包脚本跳过，不影响运行。根目录历史RELEASE_MANIFEST/SHA256SUMS不代表本次修改后的工作区，新发行包内部清单有效。

## 入口与复现

默认原版入口：[dist/beambench-standalone.html](../../dist/beambench-standalone.html)。基础入口：[dist-basic/beambench-standalone.html](../../dist-basic/beambench-standalone.html)。

安装时将偏振ZIP解压为optics-libraries/polarization/library.json，再执行npm run build:basic。已有示范安装版（仅用于本次验收，非实际安装状态）见[隔离构建](../../artifacts/modular-optics-v1/build-fixture/basic-installed/beambench-standalone.html)。

自动检查：npm run test:unit:run、npm run verify:optics；具备浏览器权限的环境可继续npm run test:optics:browser。首次需先运行verify:optics生成隔离构建。未运行完整原E2E、性能与冷安装；没有扩展本次范围排查历史浏览器失败。

[详细核验](../../artifacts/modular-optics-v1/final-verification.json)、[构建矩阵](../../artifacts/modular-optics-v1/build-verification.json)、[检查退出码](../../artifacts/modular-optics-v1/check-status.json)、[浏览器日志](../../artifacts/modular-optics-v1/browser.log)。
