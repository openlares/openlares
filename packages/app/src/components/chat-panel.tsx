'use client';

import { Chat } from '@openlares/ui';
import { useGatewayStore, cleanSessionName } from '@openlares/api-client';

export function ChatPanel() {
  const messages = useGatewayStore((s) => s.messages);
  const connectionStatus = useGatewayStore((s) => s.connectionStatus);
  const isStreaming = useGatewayStore((s) => s.isStreaming);
  const sendMessage = useGatewayStore((s) => s.sendMessage);
  const closeChat = useGatewayStore((s) => s.closeChat);
  const activeSessionKey = useGatewayStore((s) => s.activeSessionKey);
  const sessions = useGatewayStore((s) => s.sessions);

  // Find the active session for display name
  const activeSession = sessions.find((s) => s.sessionKey === activeSessionKey);
  const sessionDisplayName = activeSession ? cleanSessionName(activeSession) : 'Chat';

  return (
    <aside className="h-screen w-96 border-l border-gray-800 flex flex-col">
      {/* Header with session name and close button */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-200">{sessionDisplayName}</h2>
        <button
          onClick={closeChat}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          aria-label="Close chat"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Chat component */}
      <div className="flex-1 min-h-0">
        <Chat
          messages={messages}
          isStreaming={isStreaming}
          isConnected={connectionStatus === 'connected'}
          onSendMessage={(text) => void sendMessage(text)}
        />
      </div>
    </aside>
  );
}
