# 本地维护说明（fork: RandZwj/dsh-git-panel）

本仓库是 `xbzbing/dsh-git-panel` 的个人 fork，保留 MIT 许可与原始版权。
`origin` = 本 fork，`upstream` = 原作者仓库。

## 当前状态

- fork 的 `main` 跟上游 `main`（版本 1.14.0，尚未发到 npm；npm 上是 1.13.2）。
- 上游 1.14.0 已原生支持 `.code-workspace` 多根工作区（issue #121/#122、ADR-0030）：
  配置 `codeWorkspace`（`off` | `auto` | 文件名），从会话 cwd 里的 `.code-workspace`
  读取 `folders[].path`，每个目录要 realpath + `.git` + `rev-parse --show-toplevel`
  等于自身才认证。工作区外的仓库也能切换，文件浏览跟随所选根。
- 本地已实现**路线 B**：Git 面板直接读取 multi-root 插件的注册表，
  作为与 `codeWorkspace` 并列的第二个外部根来源。

## 本地改动（路线 B）

| 文件 | 内容 |
| --- | --- |
| `src/host/multi-root.ts` | 新增：读 `$DSH_HOME/storages/multi_root_workspace.json`，按会话 workspace 根（含子目录）取 `roots[]`；跳过 `access: 'read-only'`、cwd 内目录、非仓库；每个根仍需 `git rev-parse --show-toplevel` 等于自身 |
| `src/host/core.ts` | 新增 `sessionRegistryRoots`；`resolveWorkspace` 把注册表根与 `.code-workspace` 根一起交给 `repoDirExternal` 认证；`listSessionRepos` 追加 `kind: 'external'` 行（`aliasId` 作为显示名） |
| `test/unit/multi-root.test.mjs` | 6 个用例：注册表缺失/损坏、精确与祖先键匹配、只读与 cwd 内过滤、别名标签、`listSessionRepos` 列表与 `resolveWorkspace` 放行/拒绝 |

未注册的同级仓库仍然无法被选择（测试里用 `../service-a` 断言拒绝），路径规则没有放松。

## 两条可选路线

| 路线 | 做法 | 维护成本 |
| --- | --- | --- |
| A（推荐） | 从本 fork 构建 1.14.0，用 `codeWorkspace` 指向 `.code-workspace` 文件 | 零本地补丁，只跟上游 |
| B | 在 `src/host/core.ts` 增加「多根注册表」作为第二个外部根来源 | 需自己维护，可顺带向上游提 PR |

选 B 时：注册表读 `$DSH_HOME/storages/multi_root_workspace.json`（按会话 workspace 根取
`tables.roots[<root>].roots[]`），只纳入 `access !== 'read-only'` 的根；解析分支加在
`resolveWorkspace` 的 `repoDirFor` 失败之后，和 `codeWorkspace` 并列。补
`test/unit` 用例，并保持 `codeWorkspace` 默认行为不变。

## 升级上游后的检查单

1. `git fetch upstream --tags`，看 `git log main..upstream/main --oneline`
2. `git merge upstream/main`（本仓库暂无本地代码冲突点）
3. `npm ci && npm run check`（lint + typecheck + unit + e2e）
4. 在隔离 profile 启动验证，再动 desktop profile
5. 更新本文件，打 tag `local-v<上游版本>-<序号>`

## 发布/安装

- 不能以 `@xbzbing/` 名义发 npm。
- 安装：`dsh plugin add github:RandZwj/dsh-git-panel#<tag>`（会现场构建，profile 的
  `pnpm-workspace.yaml` 需允许该包构建）；或本地 `npm pack` 出 tarball 安装。
- 与 npm 同名包不能同时装进同一 profile。
