# 10 安全、权限与隐私策略

## 1. 安全原则

- 默认保守。
- 模型不可信，必须校验。
- 工具不裸露，必须包装。
- 高风险操作必须确认。
- secret 不进入模型上下文。
- Worker 不接收完整长期记忆。
- 所有执行必须可追溯。

## 2. 工具风险等级

| 等级 | 示例 | 默认 |
|---|---|---|
| read_only | 查日志、查状态 | 自动 |
| write_candidate | 记忆候选 | pending / 轻确认 |
| state_change | 重启服务、改配置 | 必须确认 |
| destructive | 删除文件、删容器 | 默认禁止 |
| unsafe | 越权、高危 | 拒绝 |

## 3. 数据隐私等级

| 等级 | 云模型 | Worker |
|---|---|---|
| public | 可用 | 可用 |
| internal | 摘要可用 | 摘要可用 |
| private | 脱敏或本地优先 | 默认不可 |
| secret | 禁止 | 禁止 |

## 4. Secret 规则

禁止：

- API Key 进入 prompt。
- token 写入 message content。
- secret 存入 memory content。
- secret 发给 Worker。
- secret 出现在用户可见 Trace。

允许：

- env 引用。
- secret_ref。
- 内部 tool runtime 读取 env。

## 5. 文件访问

file_analyze 只能访问：

- 上传文件。
- 用户配置的 workspace。
- 明确授权路径。

禁止默认访问：

- home 全目录。
- `.ssh`。
- `.env`。
- 浏览器 profile。
- 系统敏感目录。

## 6. Shell 安全

MVP 不开放 raw shell。server_diagnose 只允许预设只读命令，例如：

- docker ps
- docker inspect
- docker logs --tail
- df -h
- free -m
- ss -tulpn

## 7. Confirmation

需要确认时返回：

```json
{
  "status": "requires_confirmation",
  "confirmation": {
    "confirmation_id": "confirm_xxx",
    "title": "是否重启服务？",
    "description": "该操作会改变系统状态。",
    "risk_level": "state_change"
  }
}
```

## 8. 必测安全用例

- 模型输出 shell_exec 被拒绝。
- destructive 被拒绝。
- state_change 需要确认。
- private memory 不派发 Worker。
- secret 不进入 prompt。
- disabled node 不接任务。
