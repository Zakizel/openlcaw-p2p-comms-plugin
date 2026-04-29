export interface Message {
  /** 消息唯一ID */
  id: string;
  /** 来源agent */
  from: string;
  /** 目标agent */
  to: string;
  /** 消息内容 */
  content: unknown;
  /** 时间戳 */
  timestamp: number;
  /** 会话ID */
  conversationId: string;
  /** 父会话ID，用于嵌套会话 */
  parentConversationId?: string;
  /** 消息类型 */
  type: "message" | "request_help" | "response" | "end";
  /** 回复的消息ID */
  inReplyTo?: string;
  /** 原始发送者sessionKey，用于最终结果推送 */
  originalSender?: string;
}

export interface Conversation {
  id: string;
  parentId?: string;
  participants: string[];
  messages: Message[];
  status: "active" | "ended";
  createdAt: number;
  updatedAt: number;
}

export interface LLMDecision {
  action: "reply" | "forward" | "process" | "end";
  content?: unknown;
  targetAgent?: string;
  conversationId?: string;
  result?: unknown;
}

export interface P2PMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: unknown;
  timestamp: number;
  requestId?: string;
  chainId?: string;
  sourceAgentId?: string;
  sourceSessionKey?: string;
  conversationId?: string;
  parentConversationId?: string;
  inReplyTo?: string;
  originalSender?: string;
}

export interface SendParams {
  targetAgentId: string;
  payload: unknown;
  messageType?: string;
  requestId?: string;
  chainId?: string;
  sourceAgentId?: string;
  conversationId?: string;
  parentConversationId?: string;
  inReplyTo?: string;
  originalSender?: string;
}

export interface AgentContext {
  agentId: string;
  sessionKey?: string;
  p2pSessionKey?: string;
  metadata?: Record<string, unknown>;
}

export interface HandlerRegistration {
  agentId: string;
  messageType: string;
  handlerId: string;
  handler: (message: P2PMessage) => Promise<unknown>;
}

export interface SendResult {
  success: boolean;
  messageId: string;
  error?: string;
}

export interface ConversationContext {
  conversation: Conversation;
  recentMessages: Message[];
  allParentConversations: Conversation[];
}
