'use client';

import { Group, Panel } from 'react-resizable-panels';
import { useGatewayStore } from '@openlares/api-client';
import { ConditionalChatPanel } from './conditional-chat-panel';

export function ResizableLayout({ children }: { children: React.ReactNode }) {
  const showChat = useGatewayStore((s) => s.showChat);

  // When chat is closed, render content at full width without resizable panels
  if (!showChat) {
    return <main className="h-full flex-1 min-h-0 overflow-hidden">{children}</main>;
  }

  return (
    <Group orientation="horizontal" className="flex-1 min-h-0">
      <Panel defaultSize="70%" minSize="40%">
        <main className="h-full overflow-hidden">{children}</main>
      </Panel>
      <ConditionalChatPanel />
    </Group>
  );
}
