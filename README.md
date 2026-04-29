# P2P Agent Communications Plugin

Enable direct peer-to-peer messaging between agents without going through the Gateway.

## Overview

The P2P Comms plugin allows agents to communicate directly with each other through a local message bus. It supports:

- **Chain-based forwarding** with `chainId` and `sourceAgentId` tracking
- **Conversation threading** with parent-child relationships
- **LLM-driven decisions** (reply, forward, process, end)
- **Event-driven message handling** with per-agent queues

## Requirements

- OpenClaw Gateway 2026.4.0+
- Node.js 22.12+

## Installation

### From GitHub

```bash
openclaw plugins install github:your-username/p2p-comms-plugin
```

### From npm (when published)

```bash
openclaw plugins install @openclaw/p2p-comms
```

### From Source

```bash
git clone https://github.com/your-username/p2p-comms-plugin.git
cd p2p-comms-plugin
npm install
npm run build
openclaw plugins install .
```

## Configuration

Add to your OpenClaw config:

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

Then restart the Gateway:

```bash
openclaw gateway restart
```

## Tools

### p2p_list_agents

List all registered agents in the P2P message bus.

### p2p_send_message

Send a direct message to another agent.

### p2p_forward_message

Forward a message while preserving chainId and sourceAgentId.

### p2p_register_handler

Register a handler for specific message types.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      P2PMessageBus                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Agent A    │  │  Agent B    │  │  Agent C    │        │
│  │  Queue      │  │  Queue      │  │  Queue      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## License

MIT
