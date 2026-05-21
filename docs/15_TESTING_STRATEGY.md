# 15 测试策略

## 1. 必测红线

- 没有 global_master_model。
- 没有 master_agent 控制全部流程。
- 模型不能直接执行底层工具。
- Tool Compiler 不能调用 LLM。
- Worker 不接收完整长期记忆。
- private memory 默认 main-node only。
- Run Trace 覆盖每一次请求。
- destructive 默认拒绝。

## 2. 测试层级

| 类型 | 内容 |
|---|---|
| Unit | Router、Policy、Tool Compiler、Memory scoring |
| Integration | Chat → Run → Agent；Capability → Tool；Memory → Context |
| E2E | Web Chat、Run Trace、Memory Studio、Node Console |
| Security | shell 注入、secret、private memory、destructive |

## 3. Router 用例

```text
@devops 看 docker → devops_agent
帮我写 PRD → product_agent
帮我搜最新资料 → research_agent
记住我的偏好 → memory_agent
```

## 4. Policy 用例

```text
read_only server_diagnose → allow
memory_write_proposal → pending/confirm
docker_restart → requires_confirmation
file_delete → deny
raw_shell_exec → deny
secret to model → deny
private memory to worker → deny
```

## 5. Tool Compiler 用例

输入 `server_diagnose(cloudflared)`，必须生成只读 workflow，不得出现 raw shell、restart、delete。

## 6. Memory 用例

- “记住：轻量部署优先 Docker Compose” 写入 memory。
- 后续部署问题能召回。
- negative feedback 后排序下降。
