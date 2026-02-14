import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../event-bus.js';

/** Test event map */
interface TestEvents {
  ping: { ts: number };
  pong: undefined;
  greet: { name: string };
}

describe('EventBus', () => {
  it('calls the handler when an event is emitted', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('ping', handler);
    bus.emit('ping', { ts: 1234 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ ts: 1234 });
  });

  it('supports multiple handlers for the same event', () => {
    const bus = new EventBus<TestEvents>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('ping', handler1);
    bus.on('ping', handler2);
    bus.emit('ping', { ts: 42 });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('does not call handlers for other events', () => {
    const bus = new EventBus<TestEvents>();
    const pingHandler = vi.fn();
    const greetHandler = vi.fn();

    bus.on('ping', pingHandler);
    bus.on('greet', greetHandler);
    bus.emit('ping', { ts: 1 });

    expect(pingHandler).toHaveBeenCalledOnce();
    expect(greetHandler).not.toHaveBeenCalled();
  });

  it('unsubscribes via the returned function', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    const unsub = bus.on('ping', handler);
    unsub();
    bus.emit('ping', { ts: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes via off()', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('ping', handler);
    bus.off('ping', handler);
    bus.emit('ping', { ts: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('off() only removes the specific handler', () => {
    const bus = new EventBus<TestEvents>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('greet', handler1);
    bus.on('greet', handler2);
    bus.off('greet', handler1);
    bus.emit('greet', { name: 'world' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith({ name: 'world' });
  });

  it('clear() removes all listeners for all events', () => {
    const bus = new EventBus<TestEvents>();
    const pingHandler = vi.fn();
    const greetHandler = vi.fn();

    bus.on('ping', pingHandler);
    bus.on('greet', greetHandler);
    bus.clear();
    bus.emit('ping', { ts: 1 });
    bus.emit('greet', { name: 'test' });

    expect(pingHandler).not.toHaveBeenCalled();
    expect(greetHandler).not.toHaveBeenCalled();
  });

  it('emitting an event with no listeners does not throw', () => {
    const bus = new EventBus<TestEvents>();

    expect(() => bus.emit('ping', { ts: 1 })).not.toThrow();
  });

  it('handles events with undefined payload', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('pong', handler);
    bus.emit('pong', undefined);

    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it('off() is safe to call for an unregistered event', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    // Should not throw even if no listeners exist for 'pong'
    expect(() => bus.off('pong', handler)).not.toThrow();
  });
});
