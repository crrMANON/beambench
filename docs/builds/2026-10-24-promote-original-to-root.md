# 原版替换根目录完成记录

日期：2026-10-24。关联[实施前计划](../plans/2026-10-24-promote-original-to-root.md)。Process Hub 未启用，采用普通文档。

## 已完成

- 当前项目根目录已完整采用2026-10-18原版1.0.0，原版UI、材质、光照、模型、仿真源码没有调整。
- 当前2.0.1的源码、配置、文档、主题库、新版入口与产物已移至[本次备份](../../artifacts/promote-original-20261024T034425Z/previous-project/)，不参与根目录运行。此前的备份与场景证据仍在 artifacts/rollback-20261024T032843Z/。
- 原始发行ZIP在本次备份 release/ 子目录，全部102个载荷与替换后的根目录逐字节一致；94个Git基线跟踪文件与b93c92b完全一致。
- 根目录真实node_modules保留；恢复目录依赖软链接已解除。recovery/现在只剩受保护Git元数据，没有第二套活动工程。
- 新增.gitignore排除依赖、产物、备份及残留Git元数据目录；保留前次恢复计划/记录和本次计划。管理文件尚未提交。

## 验证

- 在项目根目录执行 npm run typecheck、npm run verify:docs、npm run build:standalone，均通过。Vite提示bundle超过500KB，不影响构建成功。
- 新构建另存本次证据 rebuilt-dist/；dist/最终恢复发行ZIP内原始产物，再次核验102项一致。
- 未追加浏览器自检、E2E、性能检查或冷安装；前次浏览器验证未解决项没有修复，不宣称完整浏览器验收通过。
- [核验数据](../../artifacts/promote-original-20261024T034425Z/verification.json)、[迁移清单](../../artifacts/promote-original-20261024T034425Z/migration.json)。

## 未完成：根目录Git迁移

系统以 Operation not permitted 拒绝将 recovery/beambench-20261018/.git 移至根目录；本次未请求或绕过保护权限。原Git元数据完整保留，基线提交b93c92b5b67798c82a9e313c1e22ac6d4bfc3c34、标签baseline/2026-10-18和分支recovery/original-ui均保留。

通过显式指定 --git-dir 和 --work-tree 只读检查根目录，94个跟踪文件无修改，只有新增管理文件未跟踪。项目根目录尚不能直接执行普通Git命令，也没有创建计划中的新提交。

在用户自己的终端、项目根目录中可完成剩余迁移：

```sh
mv recovery/beambench-20261018/.git .git
rmdir recovery/beambench-20261018 recovery
git add .gitignore docs/plans docs/builds
git commit -m "Record promotion of original snapshot to project root"
```

上述命令未由本次执行，也未推送GitHub。

## 当前入口

直接打开[原版单文件实验室](../../dist/beambench-standalone.html)，或在项目根目录运行 npm run dev。此前恢复目录中的应用入口已失效，统一使用根目录。
