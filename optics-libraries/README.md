# 已安装的光具库

将下载的主题ZIP解压到这里，每个库应有一层目录，例如 `polarization/library.json`。
本目录中的直接子目录均视为已安装库；不要在这里放置没有清单的目录。

构建：`npm run build:standalone`（原版全部条目加主题条目）或
`npm run build:basic`（基础条目加主题条目，产物在 `dist-basic/`）。
开发服务器需安装后重新启动。移走库目录并重新构建即可卸载；已经导出的原生场景仍可载入。

偏振库源包位于 `../library-packages/polarization/`，默认未安装。
接口和安装说明见 [模块化光具库](../docs/OPTICS_LIBRARIES.md)。
