import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { AgentRegistry, type AgentRegistryImpl } from "./agent-registry.js";
import type { AgentContext } from "./message-types.js";

const createMockAgentContext = (agentId: string): AgentContext => ({
  agentId,
  agentDescription: `Agent ${agentId}`,
  workspaceDir: `/workspace/${agentId}`,
});

describe("AgentRegistry", () => {
  let registry: AgentRegistryImpl;

  beforeEach(() => {
    registry = AgentRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  it("should be a singleton", () => {
    const instance1 = AgentRegistry.getInstance();
    const instance2 = AgentRegistry.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("should register and retrieve an agent", () => {
    const ctx = createMockAgentContext("agent-1");
    registry.register(ctx);

    expect(registry.get("agent-1")).toEqual(ctx);
    expect(registry.has("agent-1")).toBe(true);
  });

  it("should unregister an agent", () => {
    const ctx = createMockAgentContext("agent-1");
    registry.register(ctx);
    registry.unregister("agent-1");

    expect(registry.get("agent-1")).toBeUndefined();
    expect(registry.has("agent-1")).toBe(false);
  });

  it("should return all registered agents", () => {
    const ctx1 = createMockAgentContext("agent-1");
    const ctx2 = createMockAgentContext("agent-2");
    registry.register(ctx1);
    registry.register(ctx2);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.agentId)).toContain("agent-1");
    expect(all.map((a) => a.agentId)).toContain("agent-2");
  });

  it("should clear all agents", () => {
    registry.register(createMockAgentContext("agent-1"));
    registry.register(createMockAgentContext("agent-2"));
    registry.clear();

    expect(registry.getAll()).toHaveLength(0);
  });

  it("should overwrite existing agent with same id", () => {
    const ctx1 = createMockAgentContext("agent-1");
    const ctx2 = { ...createMockAgentContext("agent-1"), agentDescription: "Updated" };
    registry.register(ctx1);
    registry.register(ctx2);

    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get("agent-1")?.agentDescription).toBe("Updated");
  });
});
