/**
 * Unit tests for store logic: message filtering, metadata stripping,
 * session name cleaning, and session-scoped state management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { shouldDisplayMessage, cleanSessionName, gatewayStore } from '../store';
import type { ChatMessage } from '@openlares/core';
import type { SessionSummary } from '../protocol';

// ---------------------------------------------------------------------------
// Helper to build chat messages quickly
// ---------------------------------------------------------------------------

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// shouldDisplayMessage
// ---------------------------------------------------------------------------

describe('shouldDisplayMessage', () => {
  // --- Messages that SHOULD be displayed ---

  it('keeps normal user messages', () => {
    expect(shouldDisplayMessage(msg('user', 'Hello world'))).toBe(true);
  });

  it('keeps normal assistant messages', () => {
    expect(shouldDisplayMessage(msg('assistant', 'Here is my response'))).toBe(true);
  });

  it('keeps user messages that contain metadata envelope WITH actual content', () => {
    const content = [
      'Conversation info (untrusted metadata):',
      '```json',
      '{"conversation_label": "Guild #openlares"}',
      '```',
      '',
      'Sender (untrusted metadata):',
      '```json',
      '{"label": "Evgeniy Gerasimov"}',
      '```',
      '',
      'Hello, how are you?',
    ].join('\n');
    expect(shouldDisplayMessage(msg('user', content))).toBe(true);
  });

  it('keeps user messages with only sender metadata and actual content', () => {
    const content = [
      'Sender (untrusted metadata):',
      '```json',
      '{"label": "Evgeniy Gerasimov"}',
      '```',
      '',
      'Just the sender block plus real text',
    ].join('\n');
    expect(shouldDisplayMessage(msg('user', content))).toBe(true);
  });

  // --- Messages that should be FILTERED OUT ---

  it('filters system messages', () => {
    expect(shouldDisplayMessage(msg('system', 'You are an AI assistant'))).toBe(false);
  });

  it('filters heartbeat user prompts', () => {
    expect(shouldDisplayMessage(msg('user', 'Read HEARTBEAT.md if it exists'))).toBe(false);
  });

  it('filters user messages containing HEARTBEAT_OK', () => {
    expect(shouldDisplayMessage(msg('user', 'HEARTBEAT_OK — all clean'))).toBe(false);
  });

  it('filters assistant HEARTBEAT_OK responses', () => {
    expect(shouldDisplayMessage(msg('assistant', 'HEARTBEAT_OK'))).toBe(false);
  });

  it('filters assistant HEARTBEAT_OK with whitespace', () => {
    expect(shouldDisplayMessage(msg('assistant', '  HEARTBEAT_OK  '))).toBe(false);
  });

  it('filters assistant NO_REPLY responses', () => {
    expect(shouldDisplayMessage(msg('assistant', 'NO_REPLY'))).toBe(false);
  });

  it('filters metadata-only user messages (no real content after stripping)', () => {
    const content = [
      'Conversation info (untrusted metadata):',
      '```json',
      '{"conversation_label": "Guild #openlares"}',
      '```',
      '',
      'Sender (untrusted metadata):',
      '```json',
      '{"label": "Evgeniy Gerasimov"}',
      '```',
      '',
    ].join('\n');
    expect(shouldDisplayMessage(msg('user', content))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cleanSessionName
// ---------------------------------------------------------------------------

function session(key: string, title?: string): SessionSummary {
  return {
    sessionKey: key,
    title: title || '',
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('cleanSessionName', () => {
  it('extracts Discord channel name from session key', () => {
    expect(cleanSessionName(session('agent:main:discord:channel:123', 'Discord thread #research > earn'))).toBe(
      'Discord thread #research > earn',
    );
  });

  it('extracts channel name after hash', () => {
    expect(cleanSessionName(session('agent:main:discord:channel:123', '#openlares'))).toBe('#openlares');
  });

  it('uses title when available', () => {
    expect(cleanSessionName(session('some-key', 'My Custom Title'))).toBe('My Custom Title');
  });

  it('falls back to session key when no title', () => {
    expect(cleanSessionName(session('raw-session-key-123'))).toBe('raw-session-key-123');
  });

  it('cleans cron job prefix', () => {
    expect(cleanSessionName(session('cron-123', 'Cron: Daily Email Check'))).toBe('Daily Email Check');
  });

  it('adds robot emoji for subagent sessions', () => {
    expect(cleanSessionName(session('subagent:task-123', 'Research Task'))).toBe('\uD83E\uDD16 Research Task');
  });

  it('handles main discord session', () => {
    const result = cleanSessionName(session('discord:g-agent-main-main', ''));
    expect(result).toBe('Main');
  });
});

// ---------------------------------------------------------------------------
// Store: selectSession resets isStreaming
// ---------------------------------------------------------------------------

describe('gatewayStore.selectSession', () => {
  beforeEach(() => {
    // Reset store to known state
    gatewayStore.setState({
      activeSessionKey: 'session-a',
      messages: [msg('user', 'old message')],
      isStreaming: true,
      activityItems: [{ id: '1', type: 'tool_call', title: 'test', detail: '', timestamp: 0 }],
      showChat: false,
    });
  });

  it('clears messages when switching sessions', () => {
    gatewayStore.getState().selectSession('session-b');
    expect(gatewayStore.getState().messages).toEqual([]);
  });

  it('resets isStreaming to false when switching sessions', () => {
    gatewayStore.getState().selectSession('session-b');
    expect(gatewayStore.getState().isStreaming).toBe(false);
  });

  it('clears activity items when switching sessions', () => {
    gatewayStore.getState().selectSession('session-b');
    expect(gatewayStore.getState().activityItems).toEqual([]);
  });

  it('opens chat panel when selecting a session', () => {
    gatewayStore.getState().selectSession('session-b');
    expect(gatewayStore.getState().showChat).toBe(true);
  });

  it('updates activeSessionKey', () => {
    gatewayStore.getState().selectSession('session-b');
    expect(gatewayStore.getState().activeSessionKey).toBe('session-b');
  });
});
