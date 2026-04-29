# P2P Agent 通信插件

让 Agent 之间无需经过 Gateway 即可直接进行点对点消息传递。

## 概述

P2P Comms 插件允许 Agent 通过本地消息总线直接相互通信，支持：

- **链式转发** - 通过 `chainId` 和 `sourceAgentId` 追踪消息链路
- **会话线程** - 支持父子会话关系
- **LLM 驱动决策** - reply（回复）、forward（转发）、process（处理）、end（结束）
- **事件驱动消息处理** - 每个 Agent 独立的消息队列

## 环境要求

- OpenClaw Gateway 2026.4.0+
- Node.js 22.12+

## 安装

### 从 GitHub 安装

```bash
openclaw plugins install github:Zakizel/openlcaw-p2p-comms-plugin
```

### 从源码安装

```bash
git clone https://github.com/Zakizel/openlcaw-p2p-comms-plugin.git
cd openlcaw-p2p-comms-plugin
npm install
npm run build
openclaw plugins install .
```

## 配置

在 OpenClaw 配置文件中添加：

```json
{
  "plugins": {
    "entries": {
      "p2p-comms": {
        "enabled": true
      }
    }
  }
}
```

然后重启 Gateway：

```bash
openclaw gateway restart
```

## 工具

### p2p_list_agents

列出 P2P 消息总线中所有已注册的 Agent。

### p2p_send_message

向另一个 Agent 发送直接消息。

### p2p_forward_message

在保留 chainId 和 sourceAgentId 的情况下转发消息。

### p2p_register_handler

为特定消息类型注册处理器。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      P2PMessageBus                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Agent A    │  │  Agent B    │  │  Agent C    │        │
│  │  Queue      │  │  Queue      │  │  Queue      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## 许可证

MIT
