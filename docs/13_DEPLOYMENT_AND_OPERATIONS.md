# 13 部署与运维规格

## 1. 默认部署目标

Joi 当前默认部署目标是本机 Desktop Mode：

```text
app: /Applications/Joi.app
repo: /Users/hao/project/Joi
data: ~/Library/Application Support/Joi
secrets: macOS Keychain service "Joi Desktop"
```

Desktop Mode 不要求 Docker、Postgres、NATS 或 localhost Web Console。

## 2. Desktop 安装与升级

从真实仓库执行：

```bash
cd /Users/hao/project/Joi
./scripts/package_desktop_macos.sh
```

脚本会构建 Electron app、替换 `/Applications/Joi.app`，并保留 `~/Library/Application Support/Joi` 用户数据。

升级后至少验证：

```bash
pnpm --filter @joi/electron build
pnpm test:electron-contract
/usr/bin/codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
open -a /Applications/Joi.app
```

## 3. Runtime Health

重点检查：

- `/Applications/Joi.app/Contents/MacOS/Joi` 主进程存在。
- 窗口可见时至少存在一个 renderer helper 进程。
- `~/Library/Application Support/Joi/joi.db` 可读写。
- Keychain secret 状态可通过 Settings/diagnostics 检查，不能在日志中打印值。
- Worker Gateway、Telegram、iMessage 是可选入口，不能阻塞 Desktop 基础启动。

## 4. Backup

Desktop 备份默认本地优先：

- SQLite database，以及存在时的 WAL/SHM。
- 配置和 prompts。
- manifest。

备份必须排除明文 secrets：

```text
MODEL_API_KEY
TELEGRAM_BOT_TOKEN
WORKER_TOKEN
NODE_SECRET
ADMIN_TOKEN
```

## 5. Server Mode

Server Mode 是高级部署形态，可使用：

- orchestrator service
- Web Console
- Postgres
- NATS JetStream
- Docker Compose
- multiple workers

Server Mode 不应成为 Desktop Mode 的启动前提。

## 6. Worker Mode

Worker 节点通过 Worker Gateway 连接，不直连 Desktop SQLite，不保存完整长期记忆，不接收 secret，只接收最小任务上下文。

## 7. 故障处理

- Desktop app 打不开：先检查 `/Applications/Joi.app` 进程、renderer、签名、窗口生命周期和 `docs/54_LOCAL_REPO_AND_APP_STATE.md`。
- SQLite 不可用：拒绝新 run，保护现有数据。
- Keychain 不可用：提示配置问题，不把 secret 写入日志。
- Worker 离线：自动任务不派发，手动任务提示。
- Telegram/iMessage 失败：只影响外部入口，不影响 Desktop 本地聊天。
