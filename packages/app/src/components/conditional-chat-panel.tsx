'use client';

import { Panel, Separator } from 'react-resizable-panels';
import { useGatewayStore } from '@openlares/api-client';
import { ChatPanel } from './chat-panel';

export function ConditionalChatPanel() {
  const showChat = useGatewayStore((s) => s.showChat);

  if (!showChat) return null;

  return (
    <>
      <Separator className="w-1.5 bg-gray-900 hover:bg-amber-500/50 active:bg-amber-500/70 transition-colors cursor-col-resize" />
      <Panel defaultSize="30%" minSize="20%" maxSize="50%">
        <ChatPanel />
      </Panel>
    </>
  );
}
