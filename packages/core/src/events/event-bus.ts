/**
 * Typed event bus for communication between UI and Game layers.
 *
 * Usage:
 *   const bus = new EventBus<{ ping: { ts: number }; pong: undefined }>();
 *   bus.on('ping', (data) => console.log(data.ts));
 *   bus.emit('ping', { ts: Date.now() });
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventBus<TEvents extends Record<string, any>> {
  private listeners = new Map<keyof TEvents, Set<(data: never) => void>>();

  on<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(handler as (data: never) => void);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as (data: never) => void);
    };
  }

  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(data as never);
    }
  }

  off<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler as (data: never) => void);
  }

  clear(): void {
    this.listeners.clear();
  }
}
