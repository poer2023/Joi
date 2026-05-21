# 02 Acceptance Checklist

## 红线

- [ ] 没有 global_master_model
- [ ] 没有 master_agent
- [ ] 模型不能直接执行 shell / SQL / file_write
- [ ] Worker 没有固定 A/B 职责
- [ ] main-node 具备核心能力
- [ ] Run Trace 覆盖所有请求

## Chat

- [ ] 可发送消息
- [ ] 可收到回复
- [ ] 可查看 selected_agent
- [ ] 可打开 Run Trace

## Memory

- [ ] 可写入
- [ ] 可检索
- [ ] 可编辑
- [ ] 可禁用
- [ ] 有 usage log

## Capability

- [ ] Agent 可输出 capability_request
- [ ] Tool Compiler 可生成 workflow
- [ ] Policy 可拦截高风险
- [ ] tool_runs 有记录

## Node

- [ ] main-node 注册
- [ ] Worker 注册
- [ ] 心跳可见
- [ ] 可手动指定节点
- [ ] private 不派发 Worker
