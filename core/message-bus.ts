import { EventEmitter } from "node:events";
import type {
  P2PMessage,
  SendParams,
  HandlerRegistration,
  AgentContext,
  Conversation,
  Message,
  ConversationContext,
} from "./message-types.js";
import { AgentRegistry } from "./agent-registry.js";

class P2PMessageBusImpl extends EventEmitter {
  private static instance: P2PMessageBusImpl;
  private messageQueues: Map<string, P2PMessage[]> = new Map();
  private handlers: Map<string, HandlerRegistration> = new Map();
  private conversations: Map<string, Conversation> = new Map();
  private pollInterval: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(pollIntervalMs = 10) {
    super();
    this.pollInterval = pollIntervalMs;
  }

  static getInstance(pollIntervalMs?: number): P2PMessageBusImpl {
    if (!P2PMessageBusImpl.instance) {
      P2PMessageBusImpl.instance = new P2PMessageBusImpl(pollIntervalMs);
      P2PMessageBusImpl.instance.startPolling();
    }
    return P2PMessageBusImpl.instance;
  }

  static resetInstance(): void {
    if (P2PMessageBusImpl.instance) {
      P2PMessageBusImpl.instance.stopPolling();
      P2PMessageBusImpl.instance.removeAllListeners();
      P2PMessageBusImpl.instance.messageQueues.clear();
      P2PMessageBusImpl.instance.handlers.clear();
      P2PMessageBusImpl.instance.conversations.clear();
      P2PMessageBusImpl.instance = undefined as unknown as P2PMessageBusImpl;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      this.processQueues();
    }, this.pollInterval);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private processQueues(): void {
    for (const [agentId, queue] of this.messageQueues) {
      if (queue.length === 0) {
        continue;
      }
      const messagesToProcess = queue.splice(0, queue.length);
      for (const message of messagesToProcess) {
        const handlerKey = this.buildHandlerKey(agentId, message.type);
        const handler = this.handlers.get(handlerKey);
        if (handler) {
          this.invokeHandler(handler, message).catch((err) => {
            this.emit("handlerError", { agentId, message, error: err });
          });
        } else {
          const wildcardHandlerKey = this.buildHandlerKey(agentId, "*");
          const wildcardHandler = this.handlers.get(wildcardHandlerKey);
          if (wildcardHandler) {
            this.invokeHandler(wildcardHandler, message).catch((err) => {
              this.emit("handlerError", { agentId, message, error: err });
            });
          } else {
            this.emit("unhandledMessage", { agentId, message });
          }
        }
      }
    }
  }

  private async invokeHandler(handler: HandlerRegistration, message: P2PMessage): Promise<void> {
    try {
      const response = await handler.handler(message);
      this.emit("messageDelivered", { agentId: handler.agentId, message });
    } catch (err) {
      this.emit("handlerError", { agentId: handler.agentId, message, error: err });
    }
  }

  register(agentContext: AgentContext): void {
    if (!this.messageQueues.has(agentContext.agentId)) {
      this.messageQueues.set(agentContext.agentId, []);
    }
    AgentRegistry.getInstance().register(agentContext);
    this.emit("agentRegistered", agentContext);
  }

  unregister(agentId: string): void {
    this.messageQueues.delete(agentId);
    AgentRegistry.getInstance().unregister(agentId);
    const handlersToRemove: string[] = [];
    for (const [key, handler] of this.handlers) {
      if (handler.agentId === agentId) {
        handlersToRemove.push(key);
      }
    }
    for (const key of handlersToRemove) {
      this.handlers.delete(key);
    }
    this.emit("agentUnregistered", { agentId });
  }

  send(params: SendParams & { fromAgentId?: string; sourceSessionKey?: string }): string {
    if (!AgentRegistry.getInstance().has(params.targetAgentId)) {
      throw new Error(`Target agent ${params.targetAgentId} is not registered`);
    }
    const messageId = this.generateMessageId();

    const message: P2PMessage = {
      id: messageId,
      from: params.fromAgentId || "",
      to: params.targetAgentId,
      type: params.messageType || "command",
      payload: params.payload,
      timestamp: Date.now(),
      requestId: params.requestId,
      chainId: params.chainId,
      sourceAgentId: params.sourceAgentId,
      sourceSessionKey: params.sourceSessionKey,
      conversationId: params.conversationId,
      parentConversationId: params.parentConversationId,
      inReplyTo: params.inReplyTo,
      originalSender: params.originalSender,
    };

    this.recordMessageInConversation(message);

    const queue = this.messageQueues.get(params.targetAgentId);
    if (queue) {
      queue.push(message);
    }
    this.emit("messageSent", message);
    return messageId;
  }

  private recordMessageInConversation(message: P2PMessage): void {
    const conversationId = message.conversationId || "default";
    let conversation = this.conversations.get(conversationId);

    if (!conversation) {
      conversation = {
        id: conversationId,
        parentId: message.parentConversationId,
        participants: [],
        messages: [],
        status: "active",
        createdAt: message.timestamp,
        updatedAt: message.timestamp,
      };
      this.conversations.set(conversationId, conversation);
    }

    if (!conversation.participants.includes(message.from)) {
      conversation.participants.push(message.from);
    }
    if (!conversation.participants.includes(message.to)) {
      conversation.participants.push(message.to);
    }

    const msg: Message = {
      id: message.id,
      from: message.from,
      to: message.to,
      content: message.payload,
      timestamp: message.timestamp,
      conversationId: message.conversationId || conversationId,
      parentConversationId: message.parentConversationId,
      type: this.inferMessageType(message),
      inReplyTo: message.inReplyTo,
      originalSender: message.originalSender,
    };

    conversation.messages.push(msg);
    conversation.updatedAt = message.timestamp;
  }

  private inferMessageType(message: P2PMessage): Message["type"] {
    if (message.type === "reply") return "response";
    if (message.type === "end") return "end";
    if (message.inReplyTo) return "response";
    return "message";
  }

  registerHandler(registration: HandlerRegistration): void {
    const key = this.buildHandlerKey(registration.agentId, registration.messageType);
    this.handlers.set(key, registration);
    this.emit("handlerRegistered", registration);
  }

  unregisterHandler(agentId: string, messageType: string): void {
    const key = this.buildHandlerKey(agentId, messageType);
    this.handlers.delete(key);
    this.emit("handlerUnregistered", { agentId, messageType });
  }

  private generateMessageId(): string {
    return `p2p_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private buildHandlerKey(agentId: string, messageType: string): string {
    return `${agentId}:${messageType}`;
  }

  getQueueLength(agentId: string): number {
    return this.messageQueues.get(agentId)?.length ?? 0;
  }

  getRegisteredAgents(): readonly string[] {
    return AgentRegistry.getInstance().getAll().map((ctx) => ctx.agentId);
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  getConversationContext(agentId: string, conversationId: string): ConversationContext | undefined {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return undefined;
    }

    const allParentConversations: Conversation[] = [];
    let currentParentId = conversation.parentId;
    while (currentParentId) {
      const parent = this.conversations.get(currentParentId);
      if (parent) {
        allParentConversations.push(parent);
        currentParentId = parent.parentId;
      } else {
        break;
      }
    }

    const recentMessages = conversation.messages.slice(-20);

    return {
      conversation,
      recentMessages,
      allParentConversations,
    };
  }

  endConversation(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.status = "ended";
    }
  }

  generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

export const P2PMessageBus = P2PMessageBusImpl;
export { AgentRegistry };

export type { P2PMessageBusImpl };
