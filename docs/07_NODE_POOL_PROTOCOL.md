# 07 Node Pool 节点池协议

## 1. 定位

Node Pool 负责主控和 Worker 节点管理。主控具备完整能力，Worker 只是弹性资源。

## 2. 节点类型

| 类型 | 说明 |
|---|---|
| main-node | 主控 + 默认执行节点 |
| worker-node | 弹性执行节点 |
| edge-node | 可选公网入口节点 |

## 3. 节点注册

```json
{
  "node_id": "node-vps-la",
  "name": "LA VPS",
  "role": "worker",
  "capabilities": ["web_fetch", "browser_task", "server_diagnose", "model_proxy"],
  "resources": {
    "cpu_cores": 2,
    "memory_gb": 2
  },
  "assign_policy": {
    "manual_assignable": true,
    "auto_assignable": true,
    "allow_private_context": false,
    "allow_secret_context": false
  },
  "status": "healthy"
}
```

## 4. 心跳

Worker 每 10-30 秒上报：

```json
{
  "node_id": "node-vps-la",
  "status": "healthy",
  "load": {
    "cpu_percent": 20,
    "memory_percent": 40,
    "running_tasks": 1
  },
  "capabilities": ["web_fetch", "server_diagnose"],
  "version": "0.1.0"
}
```

## 5. 调度策略

优先级：

1. 用户手动指定节点。
2. 隐私和安全限制。
3. capability 匹配。
4. 节点健康。
5. 当前负载。
6. 历史成功率。
7. 区域 / 网络线路。

## 6. 隐私规则

| privacy_level | Worker |
|---|---|
| public | 允许 |
| internal | 摘要允许 |
| private | 默认不允许 |
| secret | 禁止 |

## 7. Worker 上下文最小化

禁止发给 Worker：

- 完整长期记忆
- secret
- API key
- 用户完整历史对话
- 不相关文件内容

允许发给 Worker：

- task goal
- necessary inputs
- summarized context
- workflow steps
- temporary task token

## 8. 失败处理

- 手动指定节点离线：提示用户，可回退。
- 自动节点失败：重试其他节点，再回退 main-node。
- 超时：记录 task_attempt failed。
- Worker 错误：写入 Trace，不把内部栈直接给用户。
