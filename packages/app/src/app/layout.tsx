import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { ChatPanel } from '@/components/chat-panel';
import { GatewayProvider } from '@/providers/gateway-provider';

export const metadata: Metadata = {
  title: 'OpenLares',
  description: 'Visual interactive platform for AI agent personas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full bg-gray-950 text-gray-100 antialiased">
        <GatewayProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
            <ChatPanel />
          </div>
        </GatewayProvider>
      </body>
    </html>
  );
}
