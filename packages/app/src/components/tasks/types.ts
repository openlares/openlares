/** Client-side types for the tasks dashboard. */

export interface Dashboard {
  id: string;
  name: string;
  config: { maxConcurrentAgents?: number } | null;
  createdAt: number;
  updatedAt: number;
}

export interface Queue {
  id: string;
  dashboardId: string;
  name: string;
  ownerType: 'human' | 'assistant';
  description: string | null;
  position: number;
  agentLimit: number;
  createdAt: number;
  updatedAt: number;
}

export interface Transition {
  id: string;
  fromQueueId: string;
  toQueueId: string;
  actorType: 'human' | 'assistant' | 'both';
  conditions: Record<string, unknown> | null;
  autoTrigger: boolean;
  createdAt: number;
}

export interface Task {
  id: string;
  dashboardId: string;
  queueId: string;
  title: string;
  description: string | null;
  priority: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  sessionKey: string | null;
  assignedAgent: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}
