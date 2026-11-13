# ADR-0032：分支行的推送按分支解析，不检出也能推

状态：Accepted

## Context

ADR-0007 的推送控件只服务**当前分支**：`git push` 不带参数，目标由 HEAD 与它的 upstream 决定。分支列表里其他分支的领先/落后本来只用于显示（`↑2 ↓3` 小箭头），想推其中一个必须先在面板里切换过去。

IDEA 的分支右键给出的是一个按行操作的入口：对**当前**分支提供同步/更新/推送，对**其他**分支只提供推送（不检出、不改工作区）。git 本身也支持这一点：`git push <remote> <branch>` 推送任意本地分支，只要不是强推，远端对非快进照样拒绝。

风险在于“按名推送”要决定推到哪个远端。分支名不可信（来自 RPC），远端名也不能猜：`origin/x` 这种短名在远端名含 `/` 时会产生歧义，而拼出来的 refspec 一旦重名就可能推错目标。

## Decision

- `GitAction` 新增 `push-branch`（`{ kind, name }`）。它**只接受分支名**，不接收远端：host 用 `git for-each-ref --format=%(upstream)%00%(upstream:remotename) refs/heads/<name>` 从该分支自己的 tracking 配置解析 upstream ref 与远端名，两者都必须可用（本地 `.` upstream、未知远端一律 `no-upstream` 拒绝）。
- host 在推送前重做客户端的两条判据：分支仍存在（`git rev-parse --verify refs/heads/<name>`）、且**严格领先**（`git rev-list --count --left-right refs/heads/<name>...<upstream>` 的左侧 > 0、右侧 = 0），否则 `branch-not-ahead` 拒绝。分支名与远端名都过 `validate.ts`；**永不 `--force`**。
- 客户端只在 `capabilities.branchPush` 存在时提供入口，且只对“非当前、非远程、非标签、严格领先”的行显示「推送此分支」；分叉行不显示（远端会拒绝）。当前分支行则给「同步 / 更新 / 推送」三项，分别复用状态栏的同一套运行路径。
- 菜单失败由平台弹出 `failureLabel`（这里 `common.operationFailed`），成功后 `onResync()` 刷新快照；菜单项不改选中、不改 row slider（ADR-0028）。

## Consequences

- 不切分支就能推任意领先分支；写入面只增加一条“按名推送”，没有新增可以写入任意 ref 的入口。
- 代价：每次推送前多三条本地 git 调用（存在性、tracking 解析、分叉计数），只为该行的一次点击，不进入快照轮询；旧 host 没有该能力位时分支行不出现该入口，行为与之前一致。
- 「更新/拉取」仍然只对当前分支提供：不检出就无法把上游**合并**进其他分支，而 `git fetch x:x` 是 refspec 更新、不是 IDEA 的语义，留给需要时另立 ADR。
