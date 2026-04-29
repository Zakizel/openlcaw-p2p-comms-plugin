import type { AgentContext } from "./message-types.js";

class AgentRegistryImpl {
  private static instance: AgentRegistryImpl;
  private agents: Map<string, AgentContext> = new Map();

  private constructor() {}

  static getInstance(): AgentRegistryImpl {
    if (!AgentRegistryImpl.instance) {
      AgentRegistryImpl.instance = new AgentRegistryImpl();
    }
    return AgentRegistryImpl.instance;
  }

  register(agentContext: AgentContext): void {
    this.agents.set(agentContext.agentId, agentContext);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): AgentContext | undefined {
    return this.agents.get(agentId);
  }

  getAll(): readonly AgentContext[] {
    return Array.from(this.agents.values());
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  clear(): void {
    this.agents.clear();
  }
}

export const AgentRegistry = AgentRegistryImpl;

export type { AgentRegistryImpl };
