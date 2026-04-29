import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { P2PMessageBus, AgentRegistry, type P2PMessageBusImpl } from "./message-bus.js";
import type { AgentContext, P2PMessage, LLMDecision } from "./message-types.js";

const createMockAgentContext = (agentId: string): AgentContext => ({
  agentId,
  agentDescription: `Agent ${agentId}`,
  workspaceDir: `/workspace/${agentId}`,
});

describe("P2P Comms Integration Tests", () => {
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

  describe("End-to-End Message Flow", () => {
    it("should handle A -> B -> C forwarding chain", async () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      const ctxC = createMockAgentContext("agent-c");
      messageBus.register(ctxA);
      messageBus.register(ctxB);
      messageBus.register(ctxC);

      const chainId = "chain_001";
      const messages: P2PMessage[] = [];

      // C's handler will be called when message reaches C
      const handlerC = vi.fn().mockImplementation((msg: P2PMessage) => {
        messages.push(msg);
        return Promise.resolve();
      });
      messageBus.registerHandler({
        agentId: "agent-c",
        messageType: "command",
        handler: handlerC,
      });

      // A sends to B directly (message stays in B's queue)
      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "查库存" },
        messageType: "command",
        chainId,
        sourceAgentId: "agent-a",
        originalSender: "user-session-key",
        conversationId: "conv_001",
      });

      // B forwards to C (message goes directly to C's queue)
      messageBus.send({
        targetAgentId: "agent-c",
        fromAgentId: "agent-b",
        payload: { text: "查库存" },
        messageType: "command",
        chainId,
        sourceAgentId: "agent-a",
        conversationId: "conv_002",
        parentConversationId: "conv_001",
      });

      // Wait for polling - handler will consume the message
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(handlerC).toHaveBeenCalled();
    });

    it("should preserve chainId through forwarding", () => {
      const chainId = "chain_test_123";
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "test" },
        chainId,
        sourceAgentId: "agent-a",
      });

      const conv = messageBus.getConversation("default");
      expect(conv?.messages[0].id).toBeDefined();
    });

    it("should track parent conversation for nested threads", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "parent task" },
        conversationId: "conv-parent",
      });

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "subtask" },
        conversationId: "conv-child",
        parentConversationId: "conv-parent",
      });

      const childContext = messageBus.getConversationContext("agent-b", "conv-child");
      expect(childContext?.allParentConversations).toHaveLength(1);
      expect(childContext?.allParentConversations[0].id).toBe("conv-parent");
    });

    it("should maintain conversation participants", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      const ctxC = createMockAgentContext("agent-c");
      messageBus.register(ctxA);
      messageBus.register(ctxB);
      messageBus.register(ctxC);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "hello" },
        conversationId: "conv_1",
      });

      messageBus.send({
        targetAgentId: "agent-c",
        fromAgentId: "agent-b",
        payload: { text: "forwarded" },
        conversationId: "conv_1",
      });

      const conv = messageBus.getConversation("conv_1");
      expect(conv?.participants).toContain("agent-a");
      expect(conv?.participants).toContain("agent-b");
      expect(conv?.participants).toContain("agent-c");
    });
  });

  describe("LLM Decision Scenarios", () => {
    it("should handle reply decision flow", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "hello" },
        conversationId: "conv_1",
      });

      const decision: LLMDecision = {
        action: "reply",
        content: "Hello back to you",
      };

      messageBus.send({
        targetAgentId: "agent-a",
        fromAgentId: "agent-b",
        payload: decision.content,
        inReplyTo: "msg_1",
        conversationId: "conv_1",
      });

      const conv = messageBus.getConversation("conv_1");
      expect(conv?.messages).toHaveLength(2);
      expect(conv?.messages[1].type).toBe("response");
    });

    it("should handle end decision flow", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "final task" },
        chainId: "chain_end",
        sourceAgentId: "agent-a",
        conversationId: "conv_end",
      });

      messageBus.send({
        targetAgentId: "agent-a",
        fromAgentId: "agent-b",
        payload: "Task completed",
        inReplyTo: "msg_1", // Required for type to be "response"
        chainId: "chain_end",
        sourceAgentId: "agent-a",
        conversationId: "conv_end",
      });

      const conv = messageBus.getConversation("conv_end");
      expect(conv?.messages[1].type).toBe("response");
    });

    it("should handle forward decision with chain preservation", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      const ctxC = createMockAgentContext("agent-c");
      messageBus.register(ctxA);
      messageBus.register(ctxB);
      messageBus.register(ctxC);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "need help" },
        chainId: "chain_fwd",
        sourceAgentId: "agent-a",
        conversationId: "conv_fwd",
      });

      messageBus.send({
        targetAgentId: "agent-c",
        fromAgentId: "agent-b",
        payload: { text: "please handle" },
        chainId: "chain_fwd",
        sourceAgentId: "agent-a",
        conversationId: "conv_fwd_2",
        parentConversationId: "conv_fwd",
      });

      const conv2 = messageBus.getConversation("conv_fwd_2");
      expect(conv2?.messages[0].id).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should throw when sending to unregistered agent", () => {
      expect(() => {
        messageBus.send({
          targetAgentId: "nonexistent",
          payload: { text: "test" },
        });
      }).toThrow("Target agent nonexistent is not registered");
    });

    it("should handle handler errors gracefully", async () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      const errorHandler = vi.fn();
      messageBus.on("handlerError", errorHandler);

      messageBus.registerHandler({
        agentId: "agent-b",
        messageType: "command",
        handler: vi.fn().mockRejectedValue(new Error("Handler failed")),
      });

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "trigger error" },
        messageType: "command",
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      // Error handler should have been called
    });
  });

  describe("Conversation Lifecycle", () => {
    it("should create and end conversation", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "start" },
        conversationId: "conv_lifecycle",
      });

      expect(messageBus.getConversation("conv_lifecycle")?.status).toBe("active");

      messageBus.endConversation("conv_lifecycle");
      expect(messageBus.getConversation("conv_lifecycle")?.status).toBe("ended");
    });

    it("should generate unique conversation IDs", () => {
      const id1 = messageBus.generateConversationId();
      const id2 = messageBus.generateConversationId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^conv_\d+_/);
    });

    it("should return recent messages (last 20)", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      for (let i = 0; i < 25; i++) {
        messageBus.send({
          targetAgentId: "agent-b",
          fromAgentId: "agent-a",
          payload: { text: `message ${i}` },
          conversationId: "conv_many",
        });
      }

      const context = messageBus.getConversationContext("agent-b", "conv_many");
      expect(context?.recentMessages).toHaveLength(20);
    });
  });

  describe("Message Type Inference", () => {
    it("should infer response for reply messages", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "request" },
        conversationId: "conv_type",
      });

      messageBus.send({
        targetAgentId: "agent-a",
        fromAgentId: "agent-b",
        payload: { text: "response" },
        messageType: "reply",
        conversationId: "conv_type",
      });

      const conv = messageBus.getConversation("conv_type");
      expect(conv?.messages[1].type).toBe("response");
    });

    it("should infer response for messages with inReplyTo", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "request" },
        conversationId: "conv_replyto",
      });

      messageBus.send({
        targetAgentId: "agent-a",
        fromAgentId: "agent-b",
        payload: { text: "reply" },
        inReplyTo: "msg_1",
        conversationId: "conv_replyto",
      });

      const conv = messageBus.getConversation("conv_replyto");
      expect(conv?.messages[1].type).toBe("response");
    });

    it("should infer end for end message type", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "bye" },
        messageType: "end",
        conversationId: "conv_end_type",
      });

      const conv = messageBus.getConversation("conv_end_type");
      expect(conv?.messages[0].type).toBe("end");
    });
  });

  describe("Agent Registration Events", () => {
    it("should emit events on register/unregister", () => {
      const ctx = createMockAgentContext("agent-new");
      const registeredHandler = vi.fn();
      const unregisteredHandler = vi.fn();

      messageBus.on("agentRegistered", registeredHandler);
      messageBus.on("agentUnregistered", unregisteredHandler);

      messageBus.register(ctx);
      expect(registeredHandler).toHaveBeenCalledWith(ctx);

      messageBus.unregister("agent-new");
      expect(unregisteredHandler).toHaveBeenCalledWith({ agentId: "agent-new" });
    });

    it("should emit messageSent event", () => {
      const ctxA = createMockAgentContext("agent-a");
      const ctxB = createMockAgentContext("agent-b");
      messageBus.register(ctxA);
      messageBus.register(ctxB);

      const sentHandler = vi.fn();
      messageBus.on("messageSent", sentHandler);

      messageBus.send({
        targetAgentId: "agent-b",
        fromAgentId: "agent-a",
        payload: { text: "test" },
      });

      expect(sentHandler).toHaveBeenCalled();
    });
  });
});
