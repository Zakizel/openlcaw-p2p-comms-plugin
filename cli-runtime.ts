import fsSync from "node:fs";
import path from "node:path";
import { P2PMessageBus, AgentRegistry } from "./core/message-bus.js";
import type { P2PMessage, Conversation } from "./core/message-types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

interface MessageStats {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  byType: Record<string, number>;
  byAgent: Record<string, number>;
}

class P2PCliRuntime {
  private bus: ReturnType<typeof P2PMessageBus.getInstance>;
  private stats: MessageStats = {
    totalSent: 0,
    totalDelivered: 0,
    totalFailed: 0,
    byType: {},
    byAgent: {},
  };

  constructor() {
    P2PMessageBus.resetInstance();
    AgentRegistry.getInstance().clear();
    this.bus = P2PMessageBus.getInstance(10);
  }

  async runStatus(verbose = false): Promise<void> {
    const agents = this.bus.getRegisteredAgents();
    const conversations = this.getAllConversations();

    console.log(`\n${BOLD}P2P 消息总线状态${RESET}\n`);
    console.log(`${CYAN}已注册 Agent:${RESET} ${agents.length}`);
    for (const agentId of agents) {
      const queueLen = this.bus.getQueueLength(agentId);
      console.log(`  - ${agentId} (队列: ${queueLen})`);
    }

    console.log(`\n${CYAN}活跃会话:${RESET} ${conversations.length}`);
    for (const conv of conversations.slice(0, 10)) {
      console.log(`  - ${conv.id} (参与者: ${conv.participants.join(", ")})`);
    }
    if (conversations.length > 10) {
      console.log(`  ... 还有 ${conversations.length - 10} 个会话`);
    }

    if (verbose) {
      console.log(`\n${CYAN}消息统计:${RESET}`);
      console.log(`  总发送: ${this.stats.totalSent}`);
      console.log(`  总投递: ${this.stats.totalDelivered}`);
      console.log(`  总失败: ${this.stats.totalFailed}`);
    }

    console.log();
  }

  async runList(verbose = false): Promise<void> {
    const agents = this.bus.getRegisteredAgents();
    const conversations = this.getAllConversations();

    console.log(`\n${BOLD}已注册 Agent (${agents.length})${RESET}\n`);
    for (const agentId of agents) {
      const queueLen = this.bus.getQueueLength(agentId);
      console.log(`  ${GREEN}${agentId}${RESET} - 队列: ${queueLen}`);
    }

    console.log(`\n${BOLD}活跃会话 (${conversations.length})${RESET}\n`);
    for (const conv of conversations) {
      console.log(`  ${BLUE}${conv.id}${RESET}`);
      console.log(`    参与者: ${conv.participants.join(", ")}`);
      console.log(`    消息数: ${conv.messages.length}`);
      console.log(`    状态: ${conv.status}`);
      if (conv.parentId) {
        console.log(`    父会话: ${conv.parentId}`);
      }
      console.log();
    }
  }

  async runStats(since?: string): Promise<void> {
    const sinceTime = since ? new Date(since).getTime() : 0;
    const conversations = this.getAllConversations();

    let totalMessages = 0;
    let totalResponses = 0;
    let totalForwards = 0;
    const agentMessageCounts: Record<string, number> = {};

    for (const conv of conversations) {
      for (const msg of conv.messages) {
        if (sinceTime && msg.timestamp < sinceTime) continue;
        totalMessages++;
        agentMessageCounts[msg.from] = (agentMessageCounts[msg.from] || 0) + 1;
        if (msg.type === "response") totalResponses++;
        if (msg.type === "request_help") totalForwards++;
      }
    }

    console.log(`\n${BOLD}P2P 消息统计${RESET}\n`);
    console.log(`${CYAN}总消息数:${RESET} ${totalMessages}`);
    console.log(`${CYAN}回复数:${RESET} ${totalResponses}`);
    console.log(`${CYAN}转发数:${RESET} ${totalForwards}`);

    console.log(`\n${CYAN}按 Agent 统计:${RESET}`);
    for (const [agentId, count] of Object.entries(agentMessageCounts)) {
      console.log(`  ${agentId}: ${count}`);
    }
    console.log();
  }

  async runSend(targetAgent: string, message: string, options: {
    type?: string;
    chainId?: string;
    conversationId?: string;
  }): Promise<void> {
    if (!this.bus.getRegisteredAgents().includes(targetAgent)) {
      console.log(`${RED}错误: Agent ${targetAgent} 未注册${RESET}`);
      return;
    }

    try {
      const messageId = this.bus.send({
        targetAgentId: targetAgent,
        fromAgentId: "cli",
        payload: message,
        messageType: options.type || "command",
        chainId: options.chainId || `chain_${Date.now()}`,
        conversationId: options.conversationId || this.bus.generateConversationId(),
      });

      console.log(`\n${GREEN}消息已发送${RESET}`);
      console.log(`  消息ID: ${messageId}`);
      console.log(`  目标: ${targetAgent}`);
      console.log(`  内容: ${message}`);
      console.log();
    } catch (err) {
      console.log(`${RED}发送失败: ${err instanceof Error ? err.message : String(err)}${RESET}`);
    }
  }

  async runQueue(agentId?: string): Promise<void> {
    if (agentId) {
      if (!this.bus.getRegisteredAgents().includes(agentId)) {
        console.log(`${RED}错误: Agent ${agentId} 未注册${RESET}`);
        return;
      }
      const queueLen = this.bus.getQueueLength(agentId);
      console.log(`\n${BOLD}Agent ${agentId} 队列${RESET}`);
      console.log(`  队列长度: ${queueLen}`);
      console.log();
    } else {
      const agents = this.bus.getRegisteredAgents();
      console.log(`\n${BOLD}所有 Agent 队列状态${RESET}\n`);
      for (const aId of agents) {
        const queueLen = this.bus.getQueueLength(aId);
        console.log(`  ${aId}: ${queueLen}`);
      }
      console.log();
    }
  }

  async runTrace(chainId: string, verbose = false): Promise<void> {
    const conversations = this.getAllConversations();
    const relatedMessages: Array<{ conv: Conversation; msg: P2PMessage }> = [];

    for (const conv of conversations) {
      for (const msg of conv.messages) {
        if (msg.chainId === chainId) {
          relatedMessages.push({ conv, msg });
        }
      }
    }

    if (relatedMessages.length === 0) {
      console.log(`${YELLOW}未找到链路 ${chainId}${RESET}\n`);
      return;
    }

    console.log(`\n${BOLD}链路追踪: ${chainId}${RESET}\n`);
    console.log(`${CYAN}找到 ${relatedMessages.length} 条相关消息${RESET}\n`);

    for (const { conv, msg } of relatedMessages) {
      console.log(`会话: ${BLUE}${conv.id}${RESET}`);
      console.log(`  ${msg.from} -> ${msg.to}`);
      console.log(`  类型: ${msg.type}`);
      console.log(`  内容: ${JSON.stringify(msg.payload).slice(0, 100)}`);
      if (verbose) {
        console.log(`  时间: ${new Date(msg.timestamp).toISOString()}`);
        console.log(`  chainId: ${msg.chainId}`);
        console.log(`  sourceAgentId: ${msg.sourceAgentId}`);
      }
      console.log();
    }
  }

  async runClear(force = false): Promise<void> {
    if (!force) {
      console.log(`${YELLOW}警告: 这将清空所有消息队列！${RESET}`);
      console.log(`使用 ${BOLD}--force${RESET} 参数确认操作。\n`);
      return;
    }

    const agents = this.bus.getRegisteredAgents();
    for (const agentId of agents) {
      // Clear by unregistering and re-registering
      this.bus.unregister(agentId);
    }
    P2PMessageBus.resetInstance();
    AgentRegistry.getInstance().clear();
    this.bus = P2PMessageBus.getInstance(10);

    console.log(`${GREEN}所有队列已清空${RESET}\n`);
  }

  async runExport(outputPath?: string): Promise<void> {
    const conversations = this.getAllConversations();
    const exportData = {
      exportedAt: new Date().toISOString(),
      agents: this.bus.getRegisteredAgents(),
      conversations: conversations.map((conv) => ({
        id: conv.id,
        parentId: conv.parentId,
        participants: conv.participants,
        status: conv.status,
        messageCount: conv.messages.length,
        messages: conv.messages.map((msg) => ({
          id: msg.id,
          from: msg.from,
          to: msg.to,
          type: msg.type,
          content: msg.content,
          timestamp: new Date(msg.timestamp).toISOString(),
          chainId: msg.chainId,
        })),
      })),
    };

    const output = outputPath || `p2p-export-${Date.now()}.json`;
    fsSync.writeFileSync(output, JSON.stringify(exportData, null, 2), "utf-8");
    console.log(`${GREEN}已导出到 ${output}${RESET}\n`);
  }

  async runTest(scenario?: string): Promise<void> {
    const scenarios = this.listScenarios();
    const scenarioName = scenario || "default";

    if (!scenarios[scenarioName]) {
      console.log(`${YELLOW}未知的测试场景: ${scenarioName}${RESET}`);
      console.log(`可用场景: ${Object.keys(scenarios).join(", ")}\n`);
      return;
    }

    console.log(`\n${BOLD}运行测试场景: ${scenarioName}${RESET}\n`);
    await scenarios[scenarioName]();
    console.log(`${GREEN}测试完成${RESET}\n`);
  }

  private getAllConversations(): Conversation[] {
    // Access internal conversations through a workaround
    // Since getConversation is not public, we track through events
    const conversations: Conversation[] = [];
    const seen = new Set<string>();

    this.bus.on("messageSent", (msg: P2PMessage) => {
      const convId = msg.conversationId || "default";
      if (!seen.has(convId)) {
        seen.add(convId);
        const conv = this.bus.getConversation(convId);
        if (conv) {
          conversations.push(conv);
        }
      }
    });

    return conversations;
  }

  private listScenarios(): Record<string, () => Promise<void>> {
    return {
      default: async () => {
        console.log("默认测试场景:");
        console.log("  1. 注册两个 Agent");
        console.log("  2. Agent A 发送消息给 Agent B");
        console.log("  3. 验证消息已投递");

        this.bus.register({ agentId: "agent-a", sessionKey: "", metadata: {} });
        this.bus.register({ agentId: "agent-b", sessionKey: "", metadata: {} });

        this.bus.send({
          targetAgentId: "agent-b",
          fromAgentId: "agent-a",
          payload: "Hello from A",
          messageType: "command",
          chainId: "test-chain",
          conversationId: "test-conv",
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        const queueLen = this.bus.getQueueLength("agent-b");
        console.log(`  Agent B 队列长度: ${queueLen}`);
      },
      chain: async () => {
        console.log("链式转发测试场景:");
        console.log("  1. 注册三个 Agent (A, B, C)");
        console.log("  2. A -> B -> C 转发链");
        console.log("  3. 验证链路追踪");

        this.bus.register({ agentId: "agent-a", sessionKey: "", metadata: {} });
        this.bus.register({ agentId: "agent-b", sessionKey: "", metadata: {} });
        this.bus.register({ agentId: "agent-c", sessionKey: "", metadata: {} });

        const chainId = "chain-abc";
        this.bus.send({
          targetAgentId: "agent-b",
          fromAgentId: "agent-a",
          payload: "A to B",
          chainId,
          conversationId: "conv-a",
        });

        this.bus.send({
          targetAgentId: "agent-c",
          fromAgentId: "agent-b",
          payload: "B to C",
          chainId,
          conversationId: "conv-b",
          parentConversationId: "conv-a",
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        console.log(`  A 队列: ${this.bus.getQueueLength("agent-a")}`);
        console.log(`  B 队列: ${this.bus.getQueueLength("agent-b")}`);
        console.log(`  C 队列: ${this.bus.getQueueLength("agent-c")}`);
      },
    };
  }
}

let runtimePromise: Promise<P2PCliRuntime> | null = null;

export async function getP2pCliRuntime(): Promise<P2PCliRuntime> {
  runtimePromise ??= Promise.resolve(new P2PCliRuntime());
  return await runtimePromise;
}

export async function runP2pStatus(opts: { verbose?: boolean }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runStatus(opts.verbose);
}

export async function runP2pList(opts: { verbose?: boolean }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runList(opts.verbose);
}

export async function runP2pStats(opts: { since?: string }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runStats(opts.since);
}

export async function runP2pSend(
  agent: string,
  message: string,
  opts: { type?: string; chainId?: string; conversationId?: string }
): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runSend(agent, message, opts);
}

export async function runP2pQueue(agent?: string, opts?: { verbose?: boolean }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runQueue(agent);
}

export async function runP2pTrace(chainId: string, opts: { verbose?: boolean }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runTrace(chainId, opts.verbose);
}

export async function runP2pClear(opts: { force?: boolean }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runClear(opts.force);
}

export async function runP2pExport(opts: { output?: string }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runExport(opts.output);
}

export async function runP2pTest(opts: { scenario?: string }): Promise<void> {
  const runtime = await getP2pCliRuntime();
  await runtime.runTest(opts.scenario);
}
