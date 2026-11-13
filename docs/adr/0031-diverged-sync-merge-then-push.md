# ADR-0031：分叉分支的同步 = 显式合并上游 + 普通推送

状态：Accepted

## Context

ADR-0007 规定：push 只在当前分支**严格领先**时提供，pull 只走 `--ff-only`；分支**分叉**（既领先又落后）时两个控件都不出现，因为面板不该给「赌一把」的入口。这条规则保护了远程历史，但代价也被写进了那份 ADR：**分叉状态下面板帮不上忙，用户必须去终端**。

实际使用中这是最高频的「说不出为什么没有按钮」：分支就是既领先又落后（PR 分支 rebase 过、本地提交遇上游新提交），此时状态栏只剩一个 fetch 检查图标，用户既不能拉也不能推。

主流工具的做法值得对照，但两者都不是「放开 pull」：

- VS Code 的同步按钮按 ahead/behind 组合动作：只落后就 pull，只领先就 push，两者都有就先 pull（默认 merge，`git.pullRebase` 打开则 rebase）再 push；冲突时停在冲突现场。
- IDEA 的 Update Project 是 fetch + 把上游 merge（默认）或 rebase 进当前分支，推送是单独动作。

两者共同的原理：**先把分叉用一次显式合并变成「只领先」，推送就重新变成普通快进**。它们都没有绕过非快进限制，也没有 force。

本仓库另有两条约束决定了实现方式：host 侧已经有 `branch-merge` 这个带二次确认、冲突自动 `merge --abort` 的写操作；snapshot 里只有 `hasUpstream`/`ahead`/`behind`，**没有上游 ref 名**，所以客户端无法自己拼出 `git merge` 的目标。

## Decision

- 新增**同步（sync）**动作，只用于分叉状态（`hasUpstream && ahead > 0 && behind > 0`），并且要求上游位于一个已配置的远端、且该 host 具备 `branchMerge` 能力；其余状态仍走原有的单意图控件（快进拉取 / 普通推送 / 发布 / 设置上游）。
- 同步的真实执行是**两次既有写操作**：先 `branch-merge` 合并上游 ref，再 `push`。它**不是** `git pull`（`pull` 的合并/变基行为取决于用户 git 配置，插件无法预测），**不 rebase**，**不 force**；合并后分支严格领先，推送到远端仍是快进。
- `GitSnapshot` 新增可选字段 `upstream: { remote, branch, ref }`：host 用 `git rev-parse --symbolic-full-name @{upstream}` 取全名，再按**已配置的远端名**（最长匹配）拆出 remote 与 branch；上游是本地 `.` 分支、无上游、或旧 host 时该字段缺席，同步入口随之消失。
- 同步前**必须确认一次**，确认框写明 ahead/behind、要合并的 `remote/branch`，并提供「以后不再询问」：勾选后存进 `localStorage`（`gp.sync.noAsk`），此后一键执行。存储不可读时**继续询问**——不可读的答案不能授权一次改变历史的写操作。工作区脏时仍给出提示，但由 git 的拒绝决定是否继续。
- 冲突处理与现有合并一致：host 自动 `merge --abort` 恢复操作前状态并报错，同步**不会**在失败后继续推送。这与 VS Code 的「停在冲突现场」不同，是刻意选择：面板还没有冲突解决 UI，留下半合并状态只会让用户以为面板坏了。
- 客户端纯函数 `canSync(snapshot)` 是唯一入口判据，被状态栏使用；序列执行由 `runSnapshotSequence` 承担（一次忙碌窗口、第一个失败即停止、错误落回状态栏）。

## Consequences

- 分叉不再需要去终端：一次确认（或勾选后一次点击）即可合并上游并推送；ADR-0007 的两条不变量仍然成立——没有 force，也没有非快进的 pull。
- 代价是多了一个「历史会被改变」的按钮出现在最高频的同步位置：首次必须确认、默认不记忆，用户主动勾选才一键化。合并会生成一个 merge commit，这是合并本身的语义，不是同步额外制造的。
- 每次快照多一条 `git rev-parse`（本地命令，不联网）；`test/unit/snapshot-fingerprint.test.mjs` 的命令数断言从 9 改为 10，将来再加字段要一起复核。
- 与 VS Code 的差异要写进 README：冲突自动中止而不是留在现场；不提供 rebase 策略（需要时另立 ADR）。
- 旧 host（无 `upstream` 字段或无 `branchMerge`）上面板行为完全不变：仍然只显示状态文字，不出现同步按钮。
