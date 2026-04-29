# P2P Agent 通信插件设计文档

## 概述

P2P Agent 通信插件实现 agent 之间无需经过 Gateway 的直接消息传递，支持复杂的多 agent 协作场景（如 A 调度 B、C 协助完成任务）。

## 核心概念

### 1. 消息总线 (Message Bus)

每个 agent 拥有自己的消息队列，通过轮询机制消费消息。

```
┌─────────────────────────────────────────────────────────┐
│                     Message Bus                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │ Agent A │  │ Agent B │  │ Agent C │  │ Agent D │   │
│  │  Queue  │  │  Queue  │  │  Queue  │  │  Queue  │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └─────────┘   │
│       │             │             │                      │
│   Handler       Handler       Handler                    │
└─────────────────────────────────────────────────────────┘
```

### 2. 会话 (Conversation)

类似 IM 聊天软件，会话追踪消息的上下文和父子关系。

```typescript
interface Conversation {
  id: string;              // 会话唯一ID
  parentId?: string;       // 父会话ID（用于嵌套）
  participants: string[];   // 参与者
  messages: Message[];      // 消息历史
  status: "active" | "ended";
}
```

### 3. 消息结构

```typescript
interface Message {
  id: string;
  from: string;            // 来源agent
  to: string;              // 目标agent
  content: unknown;         // 消息内容
  timestamp: number;
  conversationId: string;   // 所属会话
  parentConversationId?: string;  // 父会话
  type: "message" | "request_help" | "response" | "end";
  inReplyTo?: string;      // 回复的消息ID
  originalSender?: string; // 原始用户sessionKey
}
```

### 4. LLM 决策

Agent 处理消息后，由 LLM 决定下一步行动：

```typescript
interface LLMDecision {
  action: "reply" | "forward" | "process" | "end";
  content?: unknown;        // 回复/转发内容
  targetAgent?: string;    // 目标agent（forward时必填）
  result?: unknown;        // 最终结果（end时使用）
}
```

## 消息流转规则

### 规则一：回复返回发送者

收到消息后，回复发送给消息的 `from`。

```
B 收到 A 的消息 → 回复发送给 A
C 收到 B 的消息 → 回复发送给 B
```

### 规则二：只有源头 agent 推送给用户

通过 `originalSender` 追踪原始用户，只有链路源头的 agent 才将最终结果推送给用户。

```
User → A → B → C → B → A → User
         (sourceAgentId: A, originalSender: user_session)
```

中间节点（B、C）收到回复不推送，只负责转发。

### 规则三：嵌套会话追踪

每次转发创建新会话，通过 `parentConversationId` 串联父子会话。

```
conv_A (A 创建，parentId: null)
  └── conv_B (A→B 时创建，parentId: conv_A)
        └── conv_C (B→C 时创建，parentId: conv_B)
```

## 协作场景示例

**场景：A 调度 B 和 C 查库存**

```
User → A: "查库存"
A → B: "需要辅助信息B"         (创建 conv_A)
B → C: "获取辅助信息C"         (创建 conv_B, parent=conv_A)
C → B: "辅助信息C"             (response)
B → A: "辅助信息B'"            (response)
A → User: "库存100件"          (end, push to originalSender)
```

### 消息流向图

```
User
  │ "查库存"
  ▼
[A] ──────────────────────────────────► pushReplyToUser("库存100件")
  │ create conv_A                         (originalSender)
  │ "需要辅助信息B"
  ▼
[B] ──────────────────────────────────► (不推送用户)
  │ create conv_B, parent=conv_A
  │ "获取辅助信息C"
  ▼
[C] ──────────────────────────────────► (不推送用户)
  │ "辅助信息C"
  ▼
[B]
  │ "辅助信息B'"
  ▼
[A]
```

## API 工具

### p2p_send_message

发送 P2P 消息给其他 agent。

```json
{
  "tool": "p2p_send_message",
  "params": {
    "targetAgentId": "B",
    "payload": "需要辅助信息B",
    "messageType": "request_help",
    "conversationId": "conv_A",
    "parentConversationId": null,
    "originalSender": "user_session_123"
  }
}
```

### p2p_forward_message

转发 P2P 消息给下一个 agent（保留链路信息）。

```json
{
  "tool": "p2p_forward_message",
  "params": {
    "targetAgentId": "C",
    "payload": "获取辅助信息C",
    "chainId": "chain_123",
    "sourceAgentId": "A",
    "conversationId": "conv_B",
    "parentConversationId": "conv_A"
  }
}
```

### p2p_list_agents

列出所有注册的 P2P agent。

```json
{
  "tool": "p2p_list_agents"
}
```

## LLM 决策格式

Agent 收到消息后，prompt 中包含完整会话上下文，LLM 返回 JSON 决策：

```json
{
  "action": "forward",
  "content": "需要辅助信息B",
  "targetAgent": "B"
}
```

### 决策类型

| action | 说明 | 使用场景 |
|--------|------|----------|
| reply | 回复发送者 | 处理完成，返回结果给上游 |
| forward | 转发给其他 agent | 需要请求帮助 |
| process | 处理并返回结果 | 收到 response 类型消息后处理 |
| end | 结束会话 | 任务完成，推送最终结果 |

## 会话上下文 Prompt

LLM 收到的 prompt 格式：

```
=== 会话上下文 ===
当前会话ID: conv_B
参与者: A, B
会话状态: active

=== 父会话链 ===
[父会话 conv_A] 参与者: A, B

=== 最近消息 ===
[A] -> [B] [请求帮助]: 需要辅助信息B
[B] -> [C] [请求帮助]: 获取辅助信息C
[C] -> [B] [回复]: 辅助信息C

=== LLM决策 ===
根据上述会话上下文，你需要做出以下决策之一：
- reply: 回复发送者
- forward: 转发给其他agent请求帮助
- process: 处理请求并返回结果给发送者
- end: 结束会话，结果返回给原始发送者

请以JSON格式返回决策：
{"action": "reply|forward|process|end", "content": ..., "targetAgent": "...", "result": ...}
```

## 文件结构

```
extensions/p2p-comms/
├── plugin.ts              # 插件入口
├── core/
│   ├── message-bus.ts     # 消息总线核心
│   ├── message-types.ts   # 类型定义
│   ├── agent-registry.ts  # Agent 注册表
│   └── hook-types.ts     # Hook 类型
├── skills/
│   └── p2p-forward/
│       └── SKILL.md       # Skill 定义文档
├── openclaw.plugin.json  # 插件配置
└── package.json
```

## 关键字段说明

| 字段 | 说明 |
|------|------|
| `chainId` | 链路 ID，串联整个交互链路 |
| `sourceAgentId` | 链路源头 agent（用于判断是否推送用户） |
| `originalSender` | 原始用户 sessionKey（用于最终结果推送） |
| `conversationId` | 当前会话 ID |
| `parentConversationId` | 父会话 ID（用于嵌套追踪） |
| `inReplyTo` | 回复的消息 ID（用于消息线程） |

## 与 Gateway 的交互

### 注册阶段

```typescript
api.registerHook("before_agent_start", (ctx) => {
  bus.register({ agentId, sessionKey: ctx.sessionKey });
  bus.registerHandler({ agentId, messageType: "*", handler });
});
```

### 消息处理

1. Agent 收到消息，进入队列
2. Handler 被调用，构造会话上下文
3. 启动子 session 运行 LLM 获取决策
4. 执行决策（reply/forward/process/end）

### 结果推送

```typescript
async function pushReplyToUser({ userSessionKey, fromAgentId, content }) {
  await callGateway({
    method: "chat.send",
    params: {
      sessionKey: userSessionKey,
      message: `[${fromAgentId}] ${content}`,
      deliver: true
    }
  });
}
```

## 设计原则

1. **无需 Gateway 中转**：消息直接在 agent 间传递
2. **链路追踪**：通过 chainId 和 sourceAgentId 追踪完整链路
3. **会话隔离**：每个转发创建新会话，通过 parentId 串联
4. **源头推送**：只有 originalSender 对应的 agent 才推送给用户
5. **LLM 驱动**：消息处理和决策完全由 LLM 完成
