'use client';

import { Chat } from '@openlares/ui';
import { useGatewayStore } from '@openlares/api-client';

export function ChatPanel() {
  const messages = useGatewayStore((s) => s.messages);
  const connectionStatus = useGatewayStore((s) => s.connectionStatus);
  const isStreaming = useGatewayStore((s) => s.isStreaming);
  const sendMessage = useGatewayStore((s) => s.sendMessage);

  return (
    <aside className="flex w-96 flex-col border-l border-gray-800">
      <Chat
        messages={messages}
        isStreaming={isStreaming}
        isConnected={connectionStatus === 'connected'}
        onSendMessage={(text) => void sendMessage(text)}
      />
    </aside>
  );
}
