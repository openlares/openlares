/**
 * @openlares/api-client — OpenClaw Gateway API client.
 *
 * Provides a WebSocket client, React hook, and Zustand store
 * for communicating with an OpenClaw Gateway instance.
 */

// Protocol types
export type {
  RequestFrame,
  ResponseFrame,
  EventFrame,
  IncomingFrame,
  GatewayError,
  ConnectChallengePayload,
  ConnectParams,
  HelloOkPayload,
  ChatEventState,
  ChatEventPayload,
  AgentEventPayload,
  TickPayload,
  ShutdownPayload,
  SystemPresencePayload,
  ChatSendParams,
  ChatSendResult,
  ChatHistoryParams,
  ChatHistoryMessage,
  ChatHistoryResult,
  ChatAbortParams,
  SessionsListParams,
  SessionSummary,
  SessionsListResult,
  StatusResult,
} from './protocol';

// Client
export {
  GatewayClient,
  reconnectDelay,
  generateRequestId,
  resetRequestCounter,
} from './gateway-client';
export type { GatewayClientOptions, EventHandler, StatusChangeHandler } from './gateway-client';

// Device identity
export { getDeviceIdentity, signConnectChallenge } from './device-identity';
export type { DeviceIdentity, DeviceSignature } from './device-identity';

// Re-export core types consumers will need
export type { ConnectionStatus, GatewayConfig } from '@openlares/core';
export { stripMetadataEnvelope } from '@openlares/core';

// React hook
export { useGateway } from './use-gateway';
export type { UseGatewayResult } from './use-gateway';

// Zustand store
export {
  gatewayStore,
  useGatewayStore,
  cleanSessionName,
  shouldDisplayMessage,
  cleanMessageContent,
} from './store';
export type { GatewayState, GatewayActions, GatewayStore } from './store';
