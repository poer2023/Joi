# Joi 本机完整访问命令策略验收

## 目标

本机 Desktop 对话默认使用 `danger_full_access`。Joi 原生 capability 在该档位不再使用 macOS `sandbox-exec`、工作区路径白名单或网络禁用规则，而是直接使用当前用户的主机环境。Codex ACP 同步切换到 `agent-full-access`，以 `dangerFullAccess` 沙箱策略运行，并将审批改为 `untrusted`：安全命令自动通过 Joi 审批，命中 `full_access_blacklist_v1` 的命令在执行前拒绝。

本机所有者的 Desktop、CLI 与 Telegram 私聊入口使用相同策略；Telegram 仍由严格用户 ID 白名单限制。既有自动任务不自动升级权限。工作区写入和浏览器交互的既有确认链继续保留，所有工具调用继续写入 Run Trace。

## 首期黑名单

- 删除与原始磁盘写入：`rm`、`rmdir`、`unlink`、`srm`、`shred`、`dd`、`mkfs*`、`newfs*`、`gpt`、`fdisk`、`wipefs`
- 提权、关机与启动安全：`sudo`、`su`、`doas`、`shutdown`、`reboot`、`halt`、`csrutil`、`nvram`、`bless`
- 账户破坏：`dscl`、`sysadminctl`
- 高危子命令：磁盘擦除/分区、`asr restore`、系统抹除安装、Time Machine 删除、钥匙串删除、FileVault 移除、服务移除、`find -delete/-exec`
- 源码丢失：`git clean`、`git restore`、`git reset --hard`、`git checkout --`
- 对 `sh/bash/zsh/fish` 的 `-c` 命令进行同一黑名单的嵌套检查，阻止最直接的绕过。

## 验收门

1. 普通本机 Desktop 对话提交 `danger_full_access`。
   Telegram 白名单所有者私聊也提交 `danger_full_access`，状态输出显示 `full_access_blacklist_v1`。
2. 完整访问命令可联网、读取和写入工作区之外的当前用户可访问路径。Joi 原生命令在 Run Trace 标记 `full_access_blacklist_v1` 且 `sandbox.enforced=false`；ACP 记录 `permission_mode.effective_mode=agent-full-access`。
3. 首期黑名单直接命令和 shell `-c` 包装均被拒绝；安装版可执行 `opencli everia recommended --limit 1 -f json`，并在真实 ACP 终端获得退出码 0。

## 边界

该黑名单是首期产品护栏，不是对任意解释器或任意脚本内容的形式化安全证明。后续应根据 Run Trace 中的真实误拦与漏拦增量维护，避免重新回到全局命令白名单。
