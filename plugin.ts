import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime/types.js";
import { callGateway } from "openclaw/gateway/call";
import { P2PMessageBus } from "./core/message-bus.js";
import { AgentRegistry } from "./core/agent-registry.js";
import type { SendParams, P2PMessage, HandlerRegistration, LLMDecision, ConversationContext } from "./core/message-types.js";
import { Type } from "typebox";

let messageBus: ReturnType<typeof P2PMessageBus.getInstance>;
let pluginRuntime: PluginRuntime | null = null;
let currentAgentId: string = "";
let currentSessionKey: string = "";

function getMessageBus() {
  if (!messageBus) {
    messageBus = P2PMessageBus.getInstance(10);
  }
  return messageBus;
}

function getRuntime(): PluginRuntime {
  if (!pluginRuntime) {
    throw new Error("Plugin runtime not initialized. Ensure plugin is running inside Gateway.");
  }
  return pluginRuntime;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

function jsonResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function payloadToString(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null) return JSON.stringify(payload);
  return String(payload);
}

async function pushReplyToUser(params: {
  userSessionKey: string;
  fromAgentId: string;
  content: string;
}): Promise<void> {
  const { userSessionKey, fromAgentId, content } = params;
  try {
    await callGateway({
      method: "chat.send",
      params: {
        sessionKey: userSessionKey,
        message: `[${fromAgentId}] ${content}`,
        deliver: true,
        idempotencyKey: `p2p_push_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      },
      timeoutMs: 5000,
    });
  } catch (err) {
    console.error("Failed to push reply to user:", err);
  }
}

function buildConversationPrompt(ctx: ConversationContext, agentId: string): string {
  const lines: string[] = [];

  lines.push("=== 会话上下文 ===");
  lines.push(`当前会话ID: ${ctx.conversation.id}`);
  lines.push(`参与者: ${ctx.conversation.participants.join(", ")}`);
  lines.push(`会话状态: ${ctx.conversation.status}`);
  lines.push("");

  if (ctx.allParentConversations.length > 0) {
    lines.push("=== 父会话链 ===");
    for (const parent of ctx.allParentConversations) {
      lines.push(`[父会话 ${parent.id}] 参与者: ${parent.participants.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("=== 最近消息 ===");
  for (const msg of ctx.recentMessages) {
    const typeTag = msg.type === "request_help" ? "[请求帮助]" :
                    msg.type === "response" ? "[回复]" :
                    msg.type === "end" ? "[结束]" : "";
    lines.push(`[${msg.from}] -> [${msg.to}] ${typeTag}: ${payloadToString(msg.content)}`);
  }
  lines.push("");

  lines.push("=== LLM决策 ===");
  lines.push("根据上述会话上下文，你需要做出以下决策之一：");
  lines.push("- reply: 回复发送者");
  lines.push("- forward: 转发给其他agent请求帮助");
  lines.push("- process: 处理请求并返回结果给发送者");
  lines.push("- end: 结束会话，结果返回给原始发送者");
  lines.push("");
  lines.push("请以JSON格式返回决策：");
  lines.push('{"action": "reply|forward|process|end", "content": ..., "targetAgent": "...", "result": ...}');

  return lines.join("\n");
}

async function handleCommandMessage(message: P2PMessage, agentId: string): Promise<{ response: string; runId: string; status: string }> {
  const runtime = getRuntime();
  const bus = getMessageBus();

  const conversationId = message.conversationId || "default";
  const ctx = bus.getConversationContext(agentId, conversationId);

  if (!ctx) {
    throw new Error(`Conversation ${conversationId} not found for agent ${agentId}`);
  }

  const promptText = payloadToString(message.payload);
  const fullPrompt = `[P2P 消息来自 ${message.from || "unknown"}]\n\n${promptText}\n\n${buildConversationPrompt(ctx, agentId)}`;

  const sessionKey = await callGateway<{ key: string }>({
    method: "sessions.create",
    params: { agentId, label: `p2p:${message.id}`, task: "" },
    timeoutMs: 10_000,
  }).then((r: { key: string }) => r.key);

  try {
    const runResult = await runtime.subagent.run({
      sessionKey,
      message: fullPrompt,
      idempotencyKey: `p2p_${message.id}`,
      deliver: false,
    });

    const waitResult = await runtime.subagent.waitForRun({
      runId: runResult.runId,
      timeoutMs: 30000,
    });

    if (waitResult.status === "error") throw new Error(waitResult.error || "Agent 运行失败");
    if (waitResult.status === "timeout") throw new Error("Agent 运行超时");

    const sessionResult = await runtime.subagent.getSessionMessages({ sessionKey, limit: 1 });
    const messages = sessionResult.messages as Array<{ role?: string; content?: string | Array<unknown> }>;
    const lastMessage = messages[messages.length - 1];

    let responseText: string;
    if (typeof lastMessage?.content === "string") {
      responseText = lastMessage.content;
    } else if (Array.isArray(lastMessage?.content)) {
      responseText = lastMessage.content
        .map((block) => (typeof block === "object" && block !== null && "text" in block ? (block as { text: string }).text : JSON.stringify(block)))
        .join("\n");
    } else {
      responseText = JSON.stringify(lastMessage?.content ?? "");
    }

    let decision: LLMDecision;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        decision = JSON.parse(jsonMatch[0]) as LLMDecision;
      } else {
        decision = { action: "reply", content: responseText };
      }
    } catch {
      decision = { action: "reply", content: responseText };
    }

    await executeLLMDecision(decision, message, agentId, bus);

    return { response: responseText, runId: runResult.runId, status: waitResult.status };
  } finally {
    try {
      await callGateway({
        method: "sessions.delete",
        params: { key: sessionKey, deleteTranscript: true, emitLifecycleHooks: false },
        timeoutMs: 5000,
      });
    } catch {
      // 尽力而为的清理
    }
  }
}

async function executeLLMDecision(
  decision: LLMDecision,
  originalMessage: P2PMessage,
  agentId: string,
  bus: ReturnType<typeof P2PMessageBus.getInstance>
): Promise<void> {
  const agentContext = AgentRegistry.getInstance().get(agentId);
  const fromAgentId = agentId;
  const sourceSessionKey = agentContext?.sessionKey;
  const requestId = generateRequestId();

  switch (decision.action) {
    case "reply":
      if (decision.targetAgent || originalMessage.from) {
        const target = decision.targetAgent || originalMessage.from;
        bus.send({
          targetAgentId: target,
          payload: decision.content,
          messageType: "response",
          requestId,
          chainId: originalMessage.chainId,
          sourceAgentId: originalMessage.sourceAgentId,
          conversationId: originalMessage.conversationId,
          parentConversationId: originalMessage.parentConversationId,
          inReplyTo: originalMessage.id,
          originalSender: originalMessage.originalSender,
          fromAgentId,
          sourceSessionKey,
        });
      }
      break;

    case "forward":
      if (decision.targetAgent) {
        const newConversationId = bus.generateConversationId();
        bus.send({
          targetAgentId: decision.targetAgent,
          payload: decision.content,
          messageType: "request_help",
          requestId,
          chainId: originalMessage.chainId || generateRequestId(),
          sourceAgentId: originalMessage.sourceAgentId || agentId,
          conversationId: newConversationId,
          parentConversationId: originalMessage.conversationId,
          originalSender: originalMessage.originalSender,
          fromAgentId,
          sourceSessionKey,
        });
      }
      break;

    case "process":
      if (originalMessage.from) {
        bus.send({
          targetAgentId: originalMessage.from,
          payload: decision.result || decision.content,
          messageType: "response",
          requestId,
          chainId: originalMessage.chainId,
          sourceAgentId: originalMessage.sourceAgentId,
          conversationId: originalMessage.conversationId,
          parentConversationId: originalMessage.parentConversationId,
          inReplyTo: originalMessage.id,
          originalSender: originalMessage.originalSender,
          fromAgentId,
          sourceSessionKey,
        });
      }
      break;

    case "end":
      bus.endConversation(originalMessage.conversationId || "default");
      if (originalMessage.originalSender && sourceSessionKey) {
        await pushReplyToUser({
          userSessionKey: originalMessage.originalSender,
          fromAgentId: agentId,
          content: payloadToString(decision.result || decision.content),
        });
      } else if (originalMessage.from) {
        bus.send({
          targetAgentId: originalMessage.from,
          payload: decision.result || decision.content,
          messageType: "end",
          requestId,
          chainId: originalMessage.chainId,
          sourceAgentId: originalMessage.sourceAgentId,
          conversationId: originalMessage.conversationId,
          parentConversationId: originalMessage.parentConversationId,
          inReplyTo: originalMessage.id,
          originalSender: originalMessage.originalSender,
          fromAgentId,
          sourceSessionKey,
        });
      }
      break;
  }
}

function createMessageHandler(agentId: string): HandlerRegistration["handler"] {
  return async (message: P2PMessage) => {
    if (message.type === "reply" || message.type === "response" || message.type === "end") {
      const bus = getMessageBus();
      const conversationId = message.conversationId || "default";
      const ctx = bus.getConversationContext(agentId, conversationId);

      if (ctx) {
        const promptText = payloadToString(message.payload);
        const fullPrompt = `[收到回复来自 ${message.from}]\n\n${promptText}\n\n${buildConversationPrompt(ctx, agentId)}`;

        const runtime = getRuntime();
        const sessionKey = await callGateway<{ key: string }>({
          method: "sessions.create",
          params: { agentId, label: `p2p:${message.id}`, task: "" },
          timeoutMs: 10_000,
        }).then((r: { key: string }) => r.key);

        try {
          const runResult = await runtime.subagent.run({
            sessionKey,
            message: fullPrompt,
            idempotencyKey: `p2p_${message.id}`,
            deliver: false,
          });

          const waitResult = await runtime.subagent.waitForRun({
            runId: runResult.runId,
            timeoutMs: 30000,
          });

          if (waitResult.status === "error") throw new Error(waitResult.error || "Agent 运行失败");
          if (waitResult.status === "timeout") throw new Error("Agent 运行超时");

          const sessionResult = await runtime.subagent.getSessionMessages({ sessionKey, limit: 1 });
          const messages = sessionResult.messages as Array<{ role?: string; content?: string | Array<unknown> }>;
          const lastMessage = messages[messages.length - 1];

          let responseText: string;
          if (typeof lastMessage?.content === "string") {
            responseText = lastMessage.content;
          } else if (Array.isArray(lastMessage?.content)) {
            responseText = lastMessage.content
              .map((block) => (typeof block === "object" && block !== null && "text" in block ? (block as { text: string }).text : JSON.stringify(block)))
              .join("\n");
          } else {
            responseText = JSON.stringify(lastMessage?.content ?? "");
          }

          let decision: LLMDecision;
          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              decision = JSON.parse(jsonMatch[0]) as LLMDecision;
            } else {
              decision = { action: "process", content: responseText };
            }
          } catch {
            decision = { action: "process", content: responseText };
          }

          await executeLLMDecision(decision, message, agentId, bus);
        } finally {
          try {
            await callGateway({
              method: "sessions.delete",
              params: { key: sessionKey, deleteTranscript: true, emitLifecycleHooks: false },
              timeoutMs: 5000,
            });
          } catch {
            // 尽力而为的清理
          }
        }
      }
      return { status: "response_processed" };
    }
    return handleCommandMessage(message, agentId);
  };
}

const P2PSendToolSchema = Type.Object({
  targetAgentId: Type.String({ minLength: 1 }),
  payload: Type.Any(),
  messageType: Type.Optional(Type.String({ default: "command" })),
  conversationId: Type.Optional(Type.String()),
  parentConversationId: Type.Optional(Type.String()),
  originalSender: Type.Optional(Type.String()),
});

const P2PForwardToolSchema = Type.Object({
  targetAgentId: Type.String({ minLength: 1 }),
  payload: Type.Any(),
  chainId: Type.String({ minLength: 1 }),
  sourceAgentId: Type.String({ minLength: 1 }),
  messageType: Type.Optional(Type.String({ default: "command" })),
  conversationId: Type.Optional(Type.String()),
  parentConversationId: Type.Optional(Type.String()),
  originalSender: Type.Optional(Type.String()),
});

function createP2PSendTool(): AnyAgentTool {
  return {
    label: "P2P Send",
    name: "p2p_send_message",
    displaySummary: "发送 P2P 消息给其他 agent",
    description: "直接向本地其他 agent 发送点对点消息，无需经过 Gateway。",
    parameters: P2PSendToolSchema,
    execute: async (_toolCallId: string, args: unknown): Promise<ToolResult> => {
      const params = args as Record<string, unknown>;
      const targetAgentId = (params.targetAgentId as string) || "";
      const payload = params.payload;
      const messageType = ((params.messageType as string) || "command");
      const conversationId = (params.conversationId as string) || undefined;
      const parentConversationId = (params.parentConversationId as string) || undefined;
      const originalSender = (params.originalSender as string) || undefined;

      if (!targetAgentId) {
        return jsonResult({ status: "error", error: "targetAgentId 不能为空" });
      }

      const bus = getMessageBus();
      if (!bus.getRegisteredAgents().includes(targetAgentId)) {
        return jsonResult({ status: "error", error: `目标 agent ${targetAgentId} 未注册` });
      }

      const fromAgentId = currentAgentId;
      const agentContext = AgentRegistry.getInstance().get(fromAgentId);
      const sourceSessionKey = agentContext?.sessionKey || currentSessionKey;
      const requestId = generateRequestId();
      const chainId = generateRequestId();

      const sendParams: SendParams & { fromAgentId?: string; sourceSessionKey?: string } = {
        targetAgentId,
        payload,
        messageType,
        requestId,
        chainId,
        sourceAgentId: fromAgentId,
        fromAgentId,
        sourceSessionKey,
        conversationId: conversationId || bus.generateConversationId(),
        parentConversationId,
        originalSender,
      };

      try {
        const messageId = bus.send(sendParams);
        return jsonResult({ status: "accepted", messageId, targetAgentId, requestId, chainId });
      } catch (err) {
        return jsonResult({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

function createP2PForwardTool(): AnyAgentTool {
  return {
    label: "P2P Forward",
    name: "p2p_forward_message",
    displaySummary: "转发 P2P 消息给下一个 agent（保留链路信息）",
    description: "当需要将 P2P 消息转发给下一个 agent 时使用，必须保留原始的 chainId 和 sourceAgentId。",
    parameters: P2PForwardToolSchema,
    execute: async (_toolCallId: string, args: unknown): Promise<ToolResult> => {
      const params = args as Record<string, unknown>;
      const targetAgentId = (params.targetAgentId as string) || "";
      const payload = params.payload;
      const chainId = (params.chainId as string) || "";
      const sourceAgentId = (params.sourceAgentId as string) || "";
      const messageType = ((params.messageType as string) || "command");
      const conversationId = (params.conversationId as string) || undefined;
      const parentConversationId = (params.parentConversationId as string) || undefined;
      const originalSender = (params.originalSender as string) || undefined;

      if (!targetAgentId) {
        return jsonResult({ status: "error", error: "targetAgentId 不能为空" });
      }
      if (!chainId) {
        return jsonResult({ status: "error", error: "chainId 不能为空" });
      }
      if (!sourceAgentId) {
        return jsonResult({ status: "error", error: "sourceAgentId 不能为空" });
      }

      const bus = getMessageBus();
      if (!bus.getRegisteredAgents().includes(targetAgentId)) {
        return jsonResult({ status: "error", error: `目标 agent ${targetAgentId} 未注册` });
      }

      const fromAgentId = currentAgentId;
      const agentContext = AgentRegistry.getInstance().get(fromAgentId);
      const sourceSessionKey = agentContext?.sessionKey || currentSessionKey;
      const requestId = generateRequestId();

      const sendParams: SendParams & { fromAgentId?: string; sourceSessionKey?: string } = {
        targetAgentId,
        payload,
        messageType,
        requestId,
        chainId,
        sourceAgentId,
        fromAgentId,
        sourceSessionKey,
        conversationId: conversationId || bus.generateConversationId(),
        parentConversationId,
        originalSender,
      };

      try {
        const messageId = bus.send(sendParams);
        return jsonResult({ status: "accepted", messageId, targetAgentId, requestId, chainId });
      } catch (err) {
        return jsonResult({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

const P2PHandlerToolSchema = Type.Object({
  messageType: Type.String({ minLength: 1 }),
  agentId: Type.Optional(Type.String()),
  action: Type.Optional(Type.Union([Type.Literal("register"), Type.Literal("unregister")])),
});

function createP2PHandlerTool(): AnyAgentTool {
  return {
    label: "P2P Handler",
    name: "p2p_register_handler",
    displaySummary: "注册 P2P 消息处理器",
    description: "注册或注销用于接收 P2P 消息的处理器。当消息发送到当前 agent 且 messageType 匹配时，处理器会被调用。",
    parameters: P2PHandlerToolSchema,
    execute: async (_toolCallId: string, args: unknown, _signal?: AbortSignal, _onUpdate?: unknown): Promise<ToolResult> => {
      const params = args as Record<string, unknown>;
      const messageType = (params.messageType as string) || "";
      const agentId = (params.agentId as string) || "";
      const action = ((params.action as string) || "register");

      if (!messageType) {
        return jsonResult({ status: "error", error: "messageType 不能为空" });
      }

      const bus = getMessageBus();
      const handlerAgentId = agentId || currentAgentId || "unknown";

      if (action === "unregister") {
        bus.unregisterHandler(handlerAgentId, messageType);
        return jsonResult({ status: "ok", message: `已注销 messageType: ${messageType} 的处理器` });
      }

      const registration = {
        agentId: handlerAgentId,
        messageType,
        handlerId: `handler_${Date.now()}`,
        handler: createMessageHandler(handlerAgentId),
      };
      bus.registerHandler(registration);

      return jsonResult({ status: "ok", message: `已注册 messageType: ${messageType} 的处理器`, handlerId: registration.handlerId });
    },
  };
}

const P2PListAgentsToolSchema = Type.Object({});

function createP2PListAgentsTool(): AnyAgentTool {
  return {
    label: "P2P List Agents",
    name: "p2p_list_agents",
    displaySummary: "列出所有注册的 P2P agent",
    description: "列出当前在 P2P 消息总线中注册的所有 agent。发送消息前可用此工具发现可用的 agent。",
    parameters: P2PListAgentsToolSchema,
    execute: async (): Promise<ToolResult> => {
      const bus = getMessageBus();
      const agents = bus.getRegisteredAgents();
      return jsonResult({
        agents: agents.map((agentId) => ({ agentId, status: "online" })),
        count: agents.length,
      });
    },
  };
}

export default definePluginEntry({
  id: "p2p-comms",
  name: "P2P Agent 通信",
  description: "实现 agent 之间无需经过 Gateway 的直接消息传递",
  register(api) {
    pluginRuntime = api.runtime as PluginRuntime;

    api.on("before_agent_start", (event, ctx) => {
      const bus = getMessageBus();
      const agentId = ctx.agentId || "unknown";
      const sessionKey = ctx.sessionKey || "";
      currentAgentId = agentId;
      currentSessionKey = sessionKey;
      bus.register({ agentId, sessionKey, metadata: {} });
      AgentRegistry.getInstance().register({ agentId, sessionKey, metadata: {} });

      bus.registerHandler({
        agentId,
        messageType: "*",
        handlerId: `default_${agentId}`,
        handler: createMessageHandler(agentId),
      });
    });

    api.on("agent_end", (event, ctx) => {
      if (ctx.agentId) {
        const bus = getMessageBus();
        bus.unregister(ctx.agentId);
        AgentRegistry.getInstance().unregister(ctx.agentId);
      }
    });

    api.registerTool(createP2PSendTool());
    api.registerTool(createP2PForwardTool());
    api.registerTool(createP2PHandlerTool());
    api.registerTool(createP2PListAgentsTool());
  },
});

export { P2PMessageBus, AgentRegistry };
