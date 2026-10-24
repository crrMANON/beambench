# 精细光具模型

精细版独立提供器件外观及机械结构，原版入口仍保留原有外观和行为。未改变桌面、环境、光照、相机、界面布局或初始器件位置；只在精细版中改变探测器的接收/阻挡行为。

## 打开与构建

- [精细基础版：26项](../dist-basic-detailed/beambench-standalone.html)：`npm run build:basic:detailed`。
- [精细默认版：30项](../dist-detailed/beambench-standalone.html)：`npm run build:detailed`。
- [原版基础入口](../dist-basic/beambench-standalone.html)和[原版默认入口](../dist/beambench-standalone.html)保留。

两种配置为独立维度：original/basic决定光具栏，original/detailed决定模型。安装/移除光具库后重新构建对应入口即可，库的API 1和已有ZIP无需更改。`optics-build.json`中`modelProfile`记录模型配置。未设置精细构建模式时使用原版。

## 全量审查与改造清单

所有现有工厂和三个主题库的预设均在范围内。同类不同焦距共享模型实现，并使用各自实际参数；不是为每一个按钮复制一份模型。

| 类型 | 发现的结构/识别问题 | 精细版处理 | 图册样本ID |
|---|---|---|---|
| 正/负薄透镜 | 圆片位于方形外框中；正负焦距外观无区别 | 圆筒镜座、压圈、安装脚；凸/凹示意曲面 | positive-lens、negative-lens |
| 双凸/双凹厚透镜 | 曲面外轮廓随计算网格，夹具深度不适配厚度 | 独立圆形可见曲面、连续侧壁、适配深度的圆镜座 | biconvex、biconcave |
| 平/凹/凸反射镜 | 方框与圆镜不协调，背部承载和调节件过于通用 | 圆承载座、背部环座、双调节旋钮；保留曲率方向 | flat-mirror、concave-mirror、convex-mirror |
| 偏振片 | 方框旋转架，轴向与刻度识别弱 | 圆旋转架、72格刻线、数字盘、固定零位和随轴角旋转指针 | polarizer |
| HWP/QWP/自定义波片 | 方框外架，类型依赖标签 | 圆旋转架、压圈、锁紧件、轴向指针；原有标签区分类型 | half-wave、quarter-wave、custom-wave |
| 法拉第旋光器 | 外观近似普通薄片 | 轴向壳体、前后通光窗口、保留原有旋光量标签 | faraday |
| 普通BS/PBS | 使用通用圆片与方架，偏振方向无模型提示 | 开放圆形薄片镜座、工作面边缘标记、PBS偏振参考线 | beam-splitter、pbs |
| 反/透光栅 | 通用玻璃平板，工作面和刻线方向难辨 | 保留方片，补边缘夹持；反/透材质区分、沟槽方向提示 | reflective-grating、transmissive-grating |
| 挡光器 | 平板与通用外壳不协调 | 哑黑吸收面、环形承载和安装连接 | beam-block |
| 探测器/功率计 | 黄色平板无法辨识传感器；外壳遮挡与穿透读数不一致 | −Z侧明确感光窗口，深色感光面、背盖、侧接线口；单面接收并吸收 | detector |
| 高斯/光线光源 | 机身和出口的轴心存在视觉偏移，连接端细节少 | 出光孔与计算原点同轴、空心镜筒、机身散热条和后连接端 | source-gaussian、source-rays |
| 公共底座和立柱 | 连接与螺钉细节弱 | 保留原有可调立柱，补底座螺钉孔和夹紧旋钮，头部安装脚与立柱相接 | 每个样本均包含支架 |

[全类原版/精细版对照与正/背/侧视图册](../artifacts/detailed-models-20261024/gallery/index.html)。本表记录实现与设计审查范围，浏览器检查状态以关联完成记录和`model-audit.json`为准。

## 探测器行为与旧场景

精细版前侧是器件局部−Z：沿局部+Z射来的光可从正面进入感光窗。反转180°后，同一光束打在背盖，不产生读数。正面接收、背面入射和打在窗外外壳上的光线均被终止，不能再到达下游器件；移走光源或转向背面后旧读数被清除。

精细版有效感光窗使用圆形半径，与当前缩放后的可见窗口一致；新增可选属性`detectorMode: "front-absorbing"`用于结构化观测的同向判定。旧场景无需迁移，精细版创建/恢复探测器时启用该行为。原版工厂继续使用旧规则，即双向读数并允许网页光线穿过；从精细版打开保存场景到原版时，适用原版规则。两种页面的下游光路可能因此不同。

程序化追迹原有的无限平面与理想孔径近似仍存在；本次只统一精细探测器的朝向、感光半径和吸收处理，不将结构化trace升级为三维外壳碰撞模拟。

## 模型真实性与参考

- 薄透镜仅有焦距，无法唯一确定实际曲率、玻璃和中心厚度，因此凸/凹外观用于识别，不能用于量取制造尺寸。
- 厚透镜与曲面镜的可见圆片单独构建，沿用实际曲率/厚度；原来的计算表面保留，所以圆形可见轮廓不代表新增真实圆孔径截断。
- BS/PBS仍按已有薄片分束方式建模，不改成立方体棱镜。光栅条纹仅表示沟槽方向，不代表真实沟槽间距、闪耀角或衍射效率。
- 刻度和旋钮是识别/机械装饰，不新增机械自由度；原有操作手柄继续负责参数调整。安装架对传播仍不产生额外遮挡。
- 使用Three.js程序化网格和自绘数字刻度，无外部CAD、品牌Logo或在线纹理依赖。典型结构参考：[圆旋转架](https://www.thorlabs.com/NewGroupPage9_PF.cfm?ObjectGroup_ID=246)、[安装波片](https://www.thorlabs.us/newgrouppage9.cfm?objectgroup_id=711&pn=WPHSM05-1550)、[薄片分束器](https://www.thorlabs.us/newgrouppage9.cfm?objectgroup_id=915&pn=BSW12)、[光栅方向](https://www.newport.com/f/060r-plane-ruled-diffraction-gratings)。不声称精确复刻某一商品。

## 开发与验证

精细版中偏振片及所有波片共用的操纵杆已修复杆身与球头分离：杆身延伸至原球心，球头位置、半径、拾取范围和角度操作方式不变。原版继续保留历史画面。完整杆身截图与验证结果见[修复记录](builds/2026-10-24-fix-detailed-ugi-connection.md)。问题截图约定保存在项目根目录AGENTS.md，原图留在feedback/，不作为生成文件覆盖。

原版源文件保持不变。`tools/detailed-models.mjs`在精细构建中使用明确且唯一的锚点连接`src/models/detailed.js`；上游源结构变化时构建会失败，而不是静默漏接。普通构建不执行这些适配。

本次改动前的30项原版页面压缩保存在`tests/fixtures/pre-detailed-standalone.html.gz`，供独立截图回归使用；解压结果与实施前检查点逐字节相同。旧的原版10项基准继续保留，没有替换。

`npm run test:unit:run`包含全类模型、全部库预设、计算表面保持、参数更新、资源释放和探测器两条传播路径测试。先构建四种入口，再运行`npm run test:models:browser`：默认用Playwright打包浏览器做原版精确截图，本机独立Chrome做精细模型交互/图册/资源测试，可用`BB_BROWSER_CHANNEL`选择功能测试浏览器。随后运行`node tools/make-model-gallery.mjs`生成图册索引。这些命令不会打开用户Chrome配置或访问GitHub。
