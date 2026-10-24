# 数据型模块化光具库 API 1

本功能只增加原生器件预设，不改原版场景、光照、材质、模型和UI样式。基础实验室1.1.0新增几何光学和高斯光束库，数据接口仍为API 1。
默认未安装库时仍显示原版10个按钮；安装后追加同样式按钮。

## 使用

1. 下载独立偏振库ZIP，解压为 `optics-libraries/polarization/library.json`。
2. 执行 `npm run build:basic`，打开 `dist-basic/beambench-standalone.html`。
3. 拖拽新增条目，继续使用原版参数面板；示例由原有“载入场景”按钮打开。

基础配置包含两种光源、薄/厚透镜、反射镜、光束阻挡器。初始场景保持原版。
`npm run build:standalone`仍构建原版全部条目，并追加安装库，产物在`dist/`。
两个产物目录互不覆盖。`npm run dev`采用原版配置；安装或卸载后需要重启服务器。
移走库目录后重新构建即完成解耦。库不负责提供新的原生工厂代码，基础版仍含原版全部工厂，故卸载后仍可恢复历史实验。

源码示例在 `library-packages/polarization/`，可直接复制到安装目录体验。
`npm run pack:optics`分别打包全部主题库；`npm run pack:optics -- --library geometric-optics`只打包指定库。偏振ZIP仍为`release/polarization-1.0.0.zip`。

| 主题 | 独立ZIP | 条目 |
| --- | --- | --- |
| 偏振 | polarization-1.0.0.zip | 7 |
| 几何光学 | geometric-optics-1.0.0.zip | 8 |
| 高斯光束 | gaussian-beams-1.0.0.zip | 5 |

新库分别位于`library-packages/geometric-optics/`和`library-packages/gaussian-beams/`，各自附三个实验和完整许可证。使用新工厂需要1.1.0基础实验室；旧偏振库不变。三个库一起安装后，基础版26条、默认版30条。未接入UI主题切换或光阑；卸载是在构建前移走对应目录。

## 清单接口

完整示例见 [library.json](../library-packages/polarization/library.json)。顶层字段为：

| 字段 | 约定 |
| --- | --- |
| apiVersion | 必须为1 |
| id | 小写字母开头，后续小写字母、数字、连字符；同一构建中唯一 |
| name / version | 显示名 / 三段数字版本 |
| presets | 非空预设列表：id、name、factory、params |

预设运行标识为 `库ID:预设ID`，不能覆盖原版按钮。安装目录按目录名称排序，库内按清单顺序追加。未知字段、重复ID、缺失清单、非法参数或不兼容版本均阻止启动/构建并报告位置；不静默降级。

| 原生工厂 | 必须显式提供的参数 |
| --- | --- |
| polarizer | axisDeg，−360至360度 |
| waveplate | type（HWP/QWP）、delta（−2π至2π弧度）、axisDeg |
| faraday | phiDeg，−360至360度 |
| beamSplitter | R（0至1）、polarizing（布尔）、polTransmit（Vertical/Horizontal） |
| multimeter | 空对象 |
| lens | f，单位m，−10至10且绝对值至少1e−6 |
| thickLens | R1/R2（同上曲率范围，m）、n（1至3）、thickness（1e−5至0.05m） |
| mirror | flat（布尔）、R（同上曲率范围，m）、refl（0至1）、n、thickness |

清单仅提供数据，不执行JavaScript，不从远端下载依赖，不扫描库中的其他代码。光具库的卸载是构建级操作，不提供运行时热卸载。半径/焦距必须是有限非零值，暂不提供平面透镜面或任意自定义镜面滤光参数。

## 兼容性与视觉边界

保存的是原生type、完整参数和位姿，不引入SceneV2或强制库依赖。波片的type/delta及PBS配置在程序接口创建和保存加载时保留。旧SceneV1缺少波片相位时仍默认HWP/π。

冻结HTML/CSS及原版环境、光照、模型、材质和物理算法；入口仅允许光具栏挂接、预设创建和参数映射改动。默认配置应与原版视觉相同，构建时间文字除外；基础配置和安装库时仅允许光具栏条目数量、内容及相应高度变化。

本阶段不提供任意新模型/新算法接口；偏振示例验证马吕斯定律和波片，不能据此宣称满足所有偏振实验。浏览器验收的实际状态以对应完成记录为准。

## 开发验证

`npm run verify:optics`在隔离测试工程中从ZIP安装，构建默认/基础的无库、有库和卸载状态，检查非法接口拒绝及单文件语法；不修改实际安装目录。
随后运行`npm run test:optics:browser`进行文件模式下的原版截图比较和真实拖拽/保存/加载/撤销测试。浏览器测试需要本机允许Playwright启动Chromium；不会启动HTTP服务。
若headless shell的软件渲染在多器件场景超时，可使用已安装的Chrome运行：`BB_BROWSER_CHANNEL=chrome npm run test:optics:browser`。这只改变测试浏览器，不读取用户Chrome资料，也不改变应用渲染设置。
原版截图基准来自固定的10月18日单文件压缩样本，不随当前构建更新。新增浏览器套件单独执行，不混入原E2E命令。
