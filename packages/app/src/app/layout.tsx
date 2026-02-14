'use client';

import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { ChatPanel } from '@/components/chat-panel';
import { GatewayProvider } from '@/providers/gateway-provider';
import { useGatewayStore } from '@openlares/api-client';

export const metadata: Metadata = {
  title: 'OpenLares',
  description: 'Visual interactive platform for AI agent personas',
};

function AppContent({ children }: { children: React.ReactNode }) {
  const showChat = useGatewayStore((s) => s.showChat);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      {showChat && <ChatPanel />}
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full bg-gray-950 text-gray-100 antialiased">
        <GatewayProvider>
          <AppContent>{children}</AppContent>
        </GatewayProvider>
      </body>
    </html>
  );
}
