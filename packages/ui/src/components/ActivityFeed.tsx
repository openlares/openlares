'use client';

import type { ActivityItem } from '@openlares/core';

/** Emoji icon for each activity type */
const TYPE_ICONS: Record<ActivityItem['type'], string> = {
  message: '💬',
  tool_call: '🔧',
  tool_result: '📋',
  error: '❌',
  status: 'ℹ️',
};

interface ActivityFeedProps {
  /** List of activity items to display */
  items: ActivityItem[];
}

/**
 * ActivityFeed — scrollable list of activity items with timestamps and icons.
 *
 * Each item shows an emoji for its type, a title, optional detail text,
 * and a human-readable timestamp.
 */
export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-600">
        No activity yet — connect to a Gateway
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
      {items.map((item) => (
        <div key={item.id} className="flex gap-2 rounded-lg bg-gray-800/50 px-3 py-2 text-sm">
          <span className="mt-0.5 shrink-0">{TYPE_ICONS[item.type]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-gray-200">{item.title}</p>
            {item.detail && <p className="mt-0.5 text-xs text-gray-500">{item.detail}</p>}
            <time className="mt-1 block text-xs text-gray-600">{formatTime(item.timestamp)}</time>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Format a unix timestamp (ms) into a short time string */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
