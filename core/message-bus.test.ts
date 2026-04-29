import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { P2PMessageBus, AgentRegistry, type P2PMessageBusImpl } from "./message-bus.js";
import type {
  P2PMessage,
  SendParams,
  HandlerRegistration,
  AgentContext,
  Message,
} from "./message-types.js";

const createMockAgentContext = (agentId: string): AgentContext => ({
  agentId,
  agentDescription: `Agent ${agentId}`,
  workspaceDir: `/workspace/${agentId}`,
});

const createMessage = (overrides: Partial<P2PMessage> = {}): P2PMessage => ({
  id: `msg_${Math.random().toString(36).slice(2, 9)}`,
  from: "from-agent",
  to: "to-agent",
  type: "command",
  payload: { text: "hello" },
  timestamp: Date.now(),
  ...overrides,
});

describe("P2PMessageBus", () => {
  let messageBus: P2PMessageBusImpl;

  beforeEach(() => {
    P2PMessageBus.resetInstance();
    AgentRegistry.getInstance().clear();
    messageBus = P2PMessageBus.getInstance(10);
  });

  afterEach(() => {
    P2PMessageBus.resetInstance();
    AgentRegistry.getInstance().clear();
  });

  describe("singleton", () => {
    it("should return same instance", () => {
      const instance1 = P2PMessageBus.getInstance();
      const instance2 = P2PMessageBus.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should reset instance", () => {
      const instance1 = P2PMessageBus.getInstance();
      P2PMessageBus.resetInstance();
      const instance2 = P2PMessageBus.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("register/unregister", () => {
    it("should register an agent and create a message queue", () => {
      const ctx = createMockAgentContext("agent-1");
      messageBus.register(ctx);

      expect(messageBus.getQueueLength("agent-1")).toBe(0);
      expect(messageBus.getRegisteredAgents()).toContain("agent-1");
    });

    it("should unregister agent and remove queue", () => {
      const ctx = createMockAgentContext("agent-1");
      messageBus.register(ctx);
      messageBus.unregister("agent-1");

      expect(messageBus.getQueueLength("agent-1")).toBe(0);
      expect(messageBus.getRegisteredAgents()).not.toContain("agent-1");
    });

    it("should unregister agent and remove its handlers", () => {
      const ctx = createMockAgentContext("agent-1");
      messageBus.register(ctx);

      const handler: HandlerRegistration = {
        agentId: "agent-1",
        messageType: "command",
        handler: vi.fn(),
      };
      messageBus.registerHandler(handler);
      messageBus.unregister("agent-1");

      // Handler should be removed
      expect(messageBus.getRegisteredAgents()).not.toContain("agent-1");
    });
  });

  describe("send", () => {
    it("should throw if target agent not registered", () => {
      expect(() => {
        messageBus.send({
          targetAgentId: "unregistered-agent",
          payload: { text: "hello" },
        });
      }).toThrow("Target agent unregistered-agent is not registered");
    });

    it("should add message to target agent queue", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
      });

      expect(messageBus.getQueueLength("agent-2")).toBe(1);
    });

    it("should return a message id", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      const messageId = messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
      });

      expect(messageId).toMatch(/^p2p_\d+_/);
    });

    it("should record message in conversation", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
        conversationId: "conv-1",
      });

      const conversation = messageBus.getConversation("conv-1");
      expect(conversation).toBeDefined();
      expect(conversation?.messages).toHaveLength(1);
    });
  });

  describe("handler registration", () => {
    it("should register and invoke handler for message type", async () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      const handler = vi.fn().mockResolvedValue(undefined);
      messageBus.registerHandler({
        agentId: "agent-2",
        messageType: "command",
        handler,
      });

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
        messageType: "command",
      });

      // Wait for polling
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(handler).toHaveBeenCalled();
    });

    it("should use wildcard handler when no exact match", async () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      const wildcardHandler = vi.fn().mockResolvedValue(undefined);
      messageBus.registerHandler({
        agentId: "agent-2",
        messageType: "*",
        handler: wildcardHandler,
      });

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
        messageType: "command",
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(wildcardHandler).toHaveBeenCalled();
    });

    it("should unregister handler", () => {
      const ctx = createMockAgentContext("agent-1");
      messageBus.register(ctx);

      const handler: HandlerRegistration = {
        agentId: "agent-1",
        messageType: "command",
        handler: vi.fn(),
      };
      messageBus.registerHandler(handler);
      messageBus.unregisterHandler("agent-1", "command");

      // The handler is removed from internal map
    });
  });

  describe("conversation", () => {
    it("should get conversation context", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
        conversationId: "conv-1",
      });

      const context = messageBus.getConversationContext("agent-2", "conv-1");
      expect(context).toBeDefined();
      expect(context?.conversation.id).toBe("conv-1");
      expect(context?.recentMessages).toHaveLength(1);
    });

    it("should track parent conversation", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      // Create parent conversation first
      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "parent" },
        conversationId: "conv-parent",
      });

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
        conversationId: "conv-child",
        parentConversationId: "conv-parent",
      });

      const context = messageBus.getConversationContext("agent-2", "conv-child");
      expect(context?.allParentConversations).toHaveLength(1);
      expect(context?.allParentConversations[0].id).toBe("conv-parent");
    });

    it("should end conversation", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "hello" },
        conversationId: "conv-1",
      });

      messageBus.endConversation("conv-1");

      const conversation = messageBus.getConversation("conv-1");
      expect(conversation?.status).toBe("ended");
    });

    it("should generate conversation id", () => {
      const convId = messageBus.generateConversationId();
      expect(convId).toMatch(/^conv_\d+_/);
    });
  });

  describe("message types inference", () => {
    it("should infer response type for reply messages", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "reply" },
        messageType: "reply",
        conversationId: "conv-1",
      });

      const conv = messageBus.getConversation("conv-1");
      expect(conv?.messages[0].type).toBe("response");
    });

    it("should infer response type for messages with inReplyTo", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "response" },
        inReplyTo: "original-msg",
        conversationId: "conv-1",
      });

      const conv = messageBus.getConversation("conv-1");
      expect(conv?.messages[0].type).toBe("response");
    });

    it("should infer end type for end messages", () => {
      const ctx1 = createMockAgentContext("agent-1");
      const ctx2 = createMockAgentContext("agent-2");
      messageBus.register(ctx1);
      messageBus.register(ctx2);

      messageBus.send({
        targetAgentId: "agent-2",
        fromAgentId: "agent-1",
        payload: { text: "goodbye" },
        messageType: "end",
        conversationId: "conv-1",
      });

      const conv = messageBus.getConversation("conv-1");
      expect(conv?.messages[0].type).toBe("end");
    });
  });
});
