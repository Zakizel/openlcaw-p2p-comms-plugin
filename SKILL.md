# P2P Agent Communications Skill

Enable direct peer-to-peer messaging between agents without going through the Gateway.

## Overview

This skill allows agents to communicate directly with each other using a local message bus with chain-based forwarding and conversation tracking.

## Key Concepts

### Chain Tracking

When a message is forwarded through multiple agents, `chainId` and `sourceAgentId` preserve the original requestor's identity throughout the chain.

- `chainId`: Unique identifier for the entire forwarding chain
- `sourceAgentId`: The original sender who initiated the chain
- `originalSender`: User session key for final result delivery

### LLM Decision Actions

When handling P2P messages, agents can respond with one of four actions:

| Action | Description |
|--------|-------------|
| `reply` | Reply directly to the sender |
| `forward` | Forward to another agent for processing |
| `process` | Process the request and return result to sender |
| `end` | End the conversation, result goes to original sender |

## Tools

### p2p_list_agents

List all agents currently registered in the P2P message bus.

**Parameters:** None

**Returns:**
```json
{
  "agents": [
    { "agentId": "agent-xxx", "status": "online" }
  ],
  "count": 1
}
```

### p2p_send_message

Send a direct P2P message to another local agent.

**Parameters:**
- `targetAgentId` (string, required): The ID of the target agent
- `payload` (any, required): The message payload
- `messageType` (string, optional): Message type identifier (default: "command")
- `chainId` (string, optional): Chain ID for forwarding chains
- `sourceAgentId` (string, optional): Original sender for chain tracking
- `conversationId` (string, optional): Conversation for message threading
- `parentConversationId` (string, optional): Parent conversation for nested threads
- `originalSender` (string, optional): User session key for final result
- `inReplyTo` (string, optional): Original message ID this is replying to

**Returns:**
```json
{
  "status": "accepted",
  "messageId": "p2p_xxx",
  "targetAgentId": "agent-xxx",
  "chainId": "chain_xxx"
}
```

### p2p_forward_message

Forward a P2P message to another agent (chain-aware forwarding).

**Parameters:**
- `targetAgentId` (string, required): Target agent ID
- `payload` (any, required): Forwarding content
- `chainId` (string, required): Must match original message's chainId
- `sourceAgentId` (string, required): Must match original message's sourceAgentId
- `conversationId` (string, optional): New conversation ID
- `parentConversationId` (string, optional): Parent conversation ID
- `originalSender` (string, optional): User session key
- `messageType` (string, optional): Message type (default: "command")

**Returns:**
```json
{
  "status": "accepted",
  "messageId": "p2p_xxx",
  "targetAgentId": "agent-xxx",
  "chainId": "chain_xxx"
}
```

**Critical Rule:** Never modify `chainId` or `sourceAgentId` when forwarding. Breaking this severs chain tracking.

## Message Handler

The plugin registers a `before_agent_start` hook that:
1. Registers the agent with the P2P message bus
2. Registers a handler for "command" message type
3. Builds conversation context for the LLM
4. Executes LLM decisions (reply/forward/process/end)

## LLM Decision Format

When the agent receives a P2P message, it should respond with:

```json
{
  "action": "reply|forward|process|end",
  "content": "Response content or result",
  "targetAgent": "target-agent-id (required for forward)"
}
```

### Decision Examples

**Reply:**
```json
{
  "action": "reply",
  "content": "Here's the information you requested"
}
```

**Forward:**
```json
{
  "action": "forward",
  "content": "Please help with this query",
  "targetAgent": "agent-c"
}
```

**Process:**
```json
{
  "action": "process",
  "content": "Task completed: processed 42 records"
}
```

**End:**
```json
{
  "action": "end",
  "content": "Final result: 42",
  "result": "42"
}
```

## Conversation Context

When processing P2P messages, the LLM receives conversation context:

```
=== P2P Message ===
From: agent-b
Type: command
Chain: chain_123
Source: agent-a
Conversation: conv_xxx

=== Content ===
查库存剩余

=== Conversation Context ===
当前会话ID: conv_xxx
参与者: agent-a, agent-b, agent-c
会话状态: active

=== 父会话链 ===
[conv_parent] 参与者: agent-a, agent-b

=== 最近消息 ===
[agent-b] -> [agent-c] [请求帮助]: 查库存剩余

=== LLM Decision ===
根据上述上下文，选择以下行动之一：
- reply: 回复发送者
- forward: 转发给其他agent请求帮助
- process: 处理请求并返回结果
- end: 结束会话，结果返回给原始发送者
```

## Complete Usage Example

### Scenario: Agent A → B → C (forwarding chain)

**Step 1: A sends to B**
```json
{
  "tool": "p2p_send_message",
  "params": {
    "targetAgentId": "agent-b",
    "payload": "查库存剩余",
    "messageType": "command",
    "sourceAgentId": "agent-a",
    "chainId": "chain_001",
    "originalSender": "user-session-key"
  }
}
```

**Step 2: B forwards to C**
```json
{
  "tool": "p2p_forward_message",
  "params": {
    "targetAgentId": "agent-c",
    "payload": "查库存剩余",
    "chainId": "chain_001",
    "sourceAgentId": "agent-a",
    "conversationId": "conv_new",
    "parentConversationId": "conv_original"
  }
}
```

**Step 3: C processes and replies to B**
```json
{
  "tool": "p2p_send_message",
  "params": {
    "targetAgentId": "agent-b",
    "payload": "库存剩余: 1000件",
    "chainId": "chain_001",
    "sourceAgentId": "agent-a"
  }
}
```

**Step 4: B replies to A**
```json
{
  "tool": "p2p_send_message",
  "params": {
    "targetAgentId": "agent-a",
    "payload": "库存剩余: 1000件",
    "chainId": "chain_001",
    "sourceAgentId": "agent-a"
  }
}
```

## Requirements

- Both agents must be running in the same OpenClaw Gateway process
- Target agent must be registered and active
- `chainId` and `sourceAgentId` must be preserved when forwarding
