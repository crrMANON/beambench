# GitHub源码检查点上传完成记录

日期：2026-10-24。关联[实施计划](../plans/2026-10-24-upload-github-checkpoint.md)，承接[本地准备记录](2026-10-24-upload-github-checkpoint.md)。Process Hub未启用，采用普通文档。

## 远端结果

- 仓库：https://github.com/crrMANON/beambench ，默认分支main。先私有上传并核验，再按用户指示设置为public；GitHub API已读回确认private=false、visibility=public。
- 首次源码检查点：f36d9f01caa9ad7dadc8da26b3098f69d0a8d195。129项源码、配置、测试、文档、库源包及已安装偏振库文件逐项与本地Git blob哈希核对一致；含原版压缩单文件测试基准。
- 追加许可声明提交：83be22274fb883962bf769f044b6b4df18e7b270，补充Vite核心/单文件运行时辅助代码的MIT全文。此完成记录将作为后续文档提交同步，最终分支头见本地核验回执。
- GitHub页面创建仓库，GitHub连接器提交源码Git树和提交并快进main；没有使用force。gh在当前执行环境仍无法连接api.github.com，因此不宣称gh push成功。

## 发布前许可证检查与修正

- 上游README明确GPL-3.0-or-later：https://github.com/visuphy/BeamBench#author--license 。固定上游提交47686d611b7b11121cfaf7be0583aee6ac34e9b0的LICENSE Git blob为f288702d2fa16d3cdf0035b15a9fcbc552cd88e7，与本地src/upstream/LICENSE逐字节对应。
- 原根LICENSE只有4154字节，含改写及缺失内容，不能作为GPL标准全文分发。根目录、偏振源包及已安装偏振库LICENSE均已替换为保留的35149字节标准全文；旧文本只保留在忽略的本地证据目录。
- 保留原版版权头，NOTICE补充原作者Hussein-Tofaili、维护方VisuPhy、独立衍生版本说明、2026-10-24变更日期及模块化内容；入口仅增加修改说明注释，没有改变功能。
- THIRD_PARTY_NOTICES.txt保留three、lil-gui和Vite核心的MIT版权及许可全文。项目源码继续按GPL-3.0-or-later提供，不改为专有许可。
- GPL第4/5节允许在遵守其条件的情况下公开修改后的源码：https://www.gnu.org/licenses/gpl.en.html 。本次检查针对已知来源及许可证，不保证不存在任何第三方权利或其他法律风险。

## 验证与未包含内容

- 12个受保护原版文件与2个入口区域哈希不变；21个测试文件、227项单元测试全部通过。没有重绘UI、替换模型或修改场景/光照/物理算法。
- 候选源码检查没有匹配常见GitHub/AWS访问密钥和私钥标记；没有上传gh配置、凭据、node_modules、dist/dist-basic、artifacts、release、本地场景备份或恢复目录Git元数据。
- 本次为源码仓库公开，不是GitHub Pages部署，也没有创建Release或上传旧ZIP/二进制产物。安装和构建方法仍见README和docs/OPTICS_LIBRARIES.md。
- 本地上传用隔离Git保留70429b5及原版b93c92b/tag，但连接器产生的是独立远端提交；这些本地SHA和baseline/2026-10-18标签未推到远端。根目录.git迁移仍未完成，不应把隔离工作树的main直接强推覆盖远端。
- 几何光学、高斯光束扩充尚未开始，光阑也未添加。本次保留扩充前可下载的源码检查点。

本地证据位于artifacts/github-checkpoint-20261024/：初始文件清单、远端清单、发布前测试日志及最终远端核验回执。旧“尚未上传”记录为先前阶段事实，以本记录为当前结果。
