'use client';

import { Group, Panel } from 'react-resizable-panels';
import { ConditionalChatPanel } from './conditional-chat-panel';

export function ResizableLayout({ children }: { children: React.ReactNode }) {
  return (
    <Group orientation="horizontal" className="flex-1 min-h-0">
      <Panel defaultSize="70%" minSize="40%">
        <main className="h-full overflow-hidden">{children}</main>
      </Panel>
      <ConditionalChatPanel />
    </Group>
  );
}
