import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { GatewayProvider } from '@/providers/gateway-provider';
import { ConditionalChatPanel } from '@/components/conditional-chat-panel';

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
            <ConditionalChatPanel />
          </div>
        </GatewayProvider>
      </body>
    </html>
  );
}
