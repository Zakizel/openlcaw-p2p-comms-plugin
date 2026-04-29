# P2P Forward Skill

当 agent 需要将 P2P 消息转发给下一个 agent 时使用此工具。

## 工具

### p2p_forward_message

将 P2P 消息转发给下一个 agent。

**参数：**
- `targetAgentId` (string, 必填): 目标 agent ID
- `payload` (any, 必填): 转发内容
- `chainId` (string, 必填): 链路 ID，必须与原始消息的 chainId 相同
- `sourceAgentId` (string, 必填): 链路源头 agent ID，必须与原始消息的 sourceAgentId 相同
- `conversationId` (string, 可选): 会话 ID，用于追踪消息所属的会话
- `parentConversationId` (string, 可选): 父会话 ID，用于嵌套会话场景
- `originalSender` (string, 可选): 原始发送者 sessionKey，用于最终结果推送
- `messageType` (string, 可选): 消息类型，默认 "command"

**返回值：**
```json
{
  "status": "accepted",
  "messageId": "p2p_xxx",
  "targetAgentId": "agent-xxx",
  "requestId": "req_xxx",
  "chainId": "chain_xxx"
}
```

## 强制规范

1. **必须保留原始消息的 chainId 和 sourceAgentId**
2. 不允许修改 chainId 和 sourceAgentId，否则链路追踪会断裂
3. 只有链路源头 agent 收到 reply 时才会推送给用户

## LLM 决策格式

当 agent 处理 P2P 消息时，需要返回 JSON 格式的决策：

```json
{
  "action": "reply|forward|process|end",
  "content": "回复内容",
  "targetAgent": "目标agent ID（forward时必填）",
  "result": "最终结果（end时使用）"
}
```

### 决策说明

- **reply**: 回复发送者
- **forward**: 转发给其他 agent 请求帮助
- **process**: 处理请求并返回结果给发送者
- **end**: 结束会话，结果返回给原始发送者

## 使用场景

### 场景：中间节点继续转发

当 agent 收到来自上游 agent 的消息，处理后需要继续转发给下游 agent 时使用。

**prompt 中会包含以下信息：**
```
[P2P 消息来自 B]
[chainId: chain_123]
[sourceAgentId: A]
[conversationId: conv_xxx]
[parentConversationId: conv_parent]

查库存剩余
```

**调用示例：**
```json
{
  "tool": "p2p_forward_message",
  "params": {
    "targetAgentId": "C",
    "payload": "查库存剩余",
    "chainId": "chain_123",
    "sourceAgentId": "A",
    "conversationId": "conv_new",
    "parentConversationId": "conv_xxx"
  }
}
```

### 场景：返回结果给上游

当 agent 处理完成，需要将结果返回给发送消息给自己的上游 agent 时使用。

**调用示例：**
```json
{
  "tool": "p2p_forward_message",
  "params": {
    "targetAgentId": "B",
    "payload": "库存剩余: 1000件",
    "chainId": "chain_123",
    "sourceAgentId": "A"
  }
}
```

## 会话上下文格式

Agent 会收到完整的会话上下文，包含：

```
=== 会话上下文 ===
当前会话ID: conv_xxx
参与者: A, B, C
会话状态: active

=== 父会话链 ===
[父会话 conv_parent] 参与者: A, B

=== 最近消息 ===
[B] -> [C] [请求帮助]: 查库存剩余
[C] -> [B] [回复]: 库存剩余: 1000件

=== LLM决策 ===
根据上述会话上下文，你需要做出以下决策之一：
- reply: 回复发送者
- forward: 转发给其他agent请求帮助
- process: 处理请求并返回结果给发送者
- end: 结束会话，结果返回给原始发送者
```

## 重要提示

- `chainId` 和 `sourceAgentId` 是链路追踪的关键字段
- LLM 在处理 P2P 消息时，必须在响应中包含这些字段的值
- 如果 LLM 不传递这些字段，转发将失败
- `originalSender` 用于指定最终结果推送给哪个用户 session
