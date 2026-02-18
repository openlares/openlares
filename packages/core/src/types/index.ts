/**
 * Connection status to an OpenClaw Gateway.
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Agent state as reported by OpenClaw.
 */
export interface AgentState {
  /** Agent session key */
  sessionKey: string;
  /** Display name */
  name: string;
  /** Whether the agent is currently active */
  active: boolean;
  /** Current model in use */
  model?: string;
}

/**
 * Gateway connection configuration.
 */
export interface GatewayConfig {
  /** WebSocket URL (e.g. ws://localhost:18789) */
  url: string;
  /** Auth token or password */
  auth: string;
}

/**
 * A chat message in a session.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

/**
 * Activity feed item — something that happened worth showing.
 */
export interface ActivityItem {
  id: string;
  type: 'message' | 'tool_call' | 'tool_result' | 'error' | 'status';
  title: string;
  detail?: string;
  timestamp: number;
}
