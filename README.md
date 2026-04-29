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

## CLI 管理命令

安装插件后，可使用以下命令管理和测试 P2P 通信：

```bash
openclaw p2p status          # 查看消息总线状态
openclaw p2p list            # 列出所有 Agent 和会话
openclaw p2p stats           # 查看消息统计
openclaw p2p send <agent> <msg>   # 发送测试消息
openclaw p2p queue [agent]   # 查看队列内容
openclaw p2p trace <chainId> # 追踪消息链路
openclaw p2p test            # 运行测试场景
```

## 卸载

如果插件影响正常使用，按以下步骤卸载：

### 1. 从配置中移除

编辑 OpenClaw 配置文件（通常是 `~/.openclaw/config.json`），删除 `plugins.entries.p2p-comms` 条目：

```json
{
  "plugins": {
    "entries": {
      "p2p-comms": null  // 或直接删除整个条目
    }
  }
}
```

### 2. 删除插件文件

```bash
# 删除插件目录
rm -rf ~/.openclaw/plugins/p2p-comms

# 或删除整个插件缓存
rm -rf ~/.openclaw/plugins/@openclaw/p2p-comms
```

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

### 4. 验证卸载

```bash
# 确认插件不再列表中
openclaw plugins list

# 应该看不到 p2p-comms
```

## 故障恢复

如果卸载后 Gateway 无法启动：

```bash
# 检查配置语法
openclaw doctor

# 或者重置配置（会丢失其他插件配置）
# cp ~/.openclaw/config.json ~/.openclaw/config.json.bak
# 重新初始化配置
```

## 许可证

MIT
