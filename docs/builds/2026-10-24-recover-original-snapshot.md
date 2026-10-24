# 原版完整快照恢复记录

日期：2026-10-24。关联[实施前计划](../plans/2026-10-24-recover-original-snapshot.md)。
Process Hub 未启用，使用普通文档。本次恢复已完成，额外验证在用户询问进度后停止，未扩展功能或修改原版源码。

## 恢复结果

- [恢复目录](../../recovery/beambench-20261018/)来自 10 月 18 日原始 ZIP，整包 SHA256 为 99f1e29748176e35a2d9c77dd96e46b8aa770cf52292c2d7e0d79c1382e158f9。
- 95 项发行清单校验通过，全部 102 个载荷文件逐字节核对通过（包含清单外5个历史 bundle及清单自身）。完成时已重新放回归档原始 dist，102项再次核对通过。
- 当前版本备份：[备份与证据目录](../../artifacts/rollback-20261024T032843Z/)，其中 current-workspace.zip 保存287个文件，备份逐文件校验通过；依赖、缓存、受保护配置目录等排除项见 backup-manifest.json。
- 备份 ZIP SHA256：fef528e88c3e7dcf410e7a9f970e046eefe3d5a755bcadfcf65796968862dbdc。
- 原浏览器标签页保持不动，已导出 SceneV2 revision105、2个器件为 current-browser-scene-v2.json；没有转换、清理浏览器存储或覆盖当前项目。

## 本地 Git

- 基线提交：b93c92b5b67798c82a9e313c1e22ac6d4bfc3c34，94个归档源码/锁文件/文档/测试文件逐个核对后提交。
- 标签：baseline/2026-10-18；当前分支：recovery/original-ui，与基线指向同一提交；工作区干净，无远端。
- 用户授权使用 GitHub 身份：crrMANON / 119035795+crrMANON@users.noreply.github.com，仅设置恢复仓库，没有修改全局身份。
- dist/依赖/缓存通过 .git/info/exclude 本地排除，未为基线修改原归档文件。node_modules 为现有依赖符号链接，不纳入 Git。
- 这是现在创建的恢复基线，不是找回过去的 Git 提交。不能恢复归档之后未留存的修改。

## 实际验证

- typecheck、lint、20文件/208项原单元测试、原文档检查通过。
- 原源码 build:standalone 成功；新构建保存在证据目录 rebuilt-dist，恢复目录 dist 最终保留归档原产物。
- 依赖复用现有 node_modules；与原锁文件依赖版本/integrity条目无差异，不宣称 npm ci 冷安装通过。
- 真实 Chrome 打开重建的原版，桌面/光照/器件/高斯参数面板可见；参数530→540及保存文件已核对；撤销后保存数据与原场景完全一致，UUID保留。
- 原生文件选择器“打开”禁用，手动加载未完成。追加的第一方文件输入/历史/训练/截图自检为4/7，存在UUID/历史等失败断言，未继续定位，也未改原版代码；不计为完整浏览器验收通过。该自检HTML在证据目录，不进入恢复源码。
- HTTP preview 监听被环境拒绝（127.0.0.1:5176 EPERM）；列出原15项E2E但未执行完整浏览器自动回归。性能、跨源宿主和全部原AC本轮未验。
- 没有复现原版正常 file:// 启动失败，因此没有添加启动修复或其他代码变更。此前关于 null origin 的观察不能据此判定本次正常单文件打开失败。

## 使用

直接打开[原版单文件页](../../recovery/beambench-20261018/dist/beambench-standalone.html)。
后续开发请切换到 recovery/beambench-20261018 目录；当前项目根目录仍保留2.0.1成果，未被替换。本轮不接回模块化功能，不推送GitHub。
原版文档里的完成声明是历史内容，不代表本轮重新认证全部产品能力；本轮实际检查以上文为准。
