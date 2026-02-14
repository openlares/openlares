'use client';

import { ActivityFeed } from '@openlares/ui';
import { useGatewayStore } from '@openlares/api-client';

export function ActivityPanel() {
  const activityItems = useGatewayStore((s) => s.activityItems);

  return (
    <aside className="flex w-80 flex-col border-l border-gray-800 bg-gray-900 p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Activity
      </h2>
      <ActivityFeed items={activityItems} />
    </aside>
  );
}
