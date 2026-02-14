'use client';

import { useGatewayStore } from '@openlares/api-client';
import { ChatPanel } from './chat-panel';

export function ConditionalChatPanel() {
  const showChat = useGatewayStore((s) => s.showChat);

  return showChat ? <ChatPanel /> : null;
}
