'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectionStatus } from '@openlares/ui';
import { useGatewayStore } from '@openlares/api-client';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Tasks', href: '/tasks' },
  { label: 'Settings', href: '/settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const connectionStatus = useGatewayStore((s) => s.connectionStatus);

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900 p-4">
      <h1 className="mb-6 text-xl font-bold tracking-tight">
        <span className="text-amber-400">Open</span>Lares
      </h1>

      <nav className="flex flex-col gap-2 text-sm text-gray-400">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-2 py-1 transition-colors ${
                isActive ? 'bg-gray-800 text-gray-100' : 'hover:bg-gray-800'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <ConnectionStatus status={connectionStatus} />
      </div>
    </aside>
  );
}
