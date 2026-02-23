/**
 * Unit tests for store logic: message filtering, metadata stripping,
 * session name cleaning, and session-scoped state management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldDisplayMessage,
  cleanSessionName,
  cleanMessageContent,
  extractLatestToolName,
  gatewayStore,
} from '../store';
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

  it('filters tool role messages', () => {
    expect(shouldDisplayMessage(msg('tool', '{"result": "some data"}'))).toBe(false);
  });

  it('filters assistant messages that are pure JSON objects', () => {
    expect(
      shouldDisplayMessage(msg('assistant', '{"id": "123", "status": "ok", "data": [1,2,3]}')),
    ).toBe(false);
  });

  it('filters assistant messages that are JSON arrays', () => {
    expect(shouldDisplayMessage(msg('assistant', '[{"key": "value"}, {"key2": "value2"}]'))).toBe(
      false,
    );
  });

  it('keeps assistant messages that look like JSON but are not', () => {
    expect(shouldDisplayMessage(msg('assistant', '{this is not json, just curly braces}'))).toBe(
      true,
    );
  });

  it('keeps assistant messages with normal text', () => {
    expect(shouldDisplayMessage(msg('assistant', 'Here is your answer: the result is 42.'))).toBe(
      true,
    );
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
    expect(
      cleanSessionName(
        session('agent:main:discord:channel:123', 'Discord thread #research > earn'),
      ),
    ).toBe('Discord thread #research > earn');
  });

  it('extracts channel name after hash', () => {
    expect(cleanSessionName(session('agent:main:discord:channel:123', '#openlares'))).toBe(
      '#openlares',
    );
  });

  it('strips discord ID prefix from title', () => {
    expect(
      cleanSessionName(
        session('agent:main:discord:channel:123', 'discord:1467208089403920651#openlares'),
      ),
    ).toBe('#openlares');
  });

  it('uses title when available', () => {
    expect(cleanSessionName(session('some-key', 'My Custom Title'))).toBe('My Custom Title');
  });

  it('falls back to session key when no title', () => {
    expect(cleanSessionName(session('raw-session-key-123'))).toBe('raw-session-key-123');
  });

  it('cleans cron job prefix', () => {
    expect(cleanSessionName(session('cron-123', 'Cron: Daily Email Check'))).toBe(
      'Daily Email Check',
    );
  });

  it('adds robot emoji for subagent sessions', () => {
    expect(cleanSessionName(session('subagent:task-123', 'Research Task'))).toBe(
      '\uD83E\uDD16 Research Task',
    );
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

  it('resets pagination state when switching sessions', () => {
    gatewayStore.setState({ hasMoreHistory: false, historyLoading: true, historyLimit: 100 });
    gatewayStore.getState().selectSession('session-c');
    expect(gatewayStore.getState().hasMoreHistory).toBe(true);
    expect(gatewayStore.getState().historyLoading).toBe(false);
    expect(gatewayStore.getState().historyLimit).toBe(20);
  });
  it('updates activeSessionKey', () => {
    gatewayStore.getState().selectSession('session-b');
    expect(gatewayStore.getState().activeSessionKey).toBe('session-b');
  });
});

// ---------------------------------------------------------------------------
// cleanMessageContent
// ---------------------------------------------------------------------------

describe('cleanMessageContent', () => {
  it('strips [Tool: ...] lines', () => {
    const input = 'Starting task\n[Tool: exec]\nCommand ran\n[Tool: read]\nFile contents';
    const result = cleanMessageContent(input);
    expect(result).toBe('Starting task\nCommand ran\nFile contents');
  });

  it('strips [Tool Result] lines', () => {
    const input = 'Checking...\n[Tool Result]\nDone';
    const result = cleanMessageContent(input);
    expect(result).toBe('Checking...\nDone');
  });

  it('strips Anthropic-format tool markers', () => {
    const input = 'Text\n[tool_use: exec]\n[tool_result: success]\nMore text';
    const result = cleanMessageContent(input);
    expect(result).toBe('Text\nMore text');
  });

  it('preserves normal content', () => {
    const input = 'Hello world\nThis is a normal message';
    expect(cleanMessageContent(input)).toBe(input);
  });

  it('handles empty input', () => {
    expect(cleanMessageContent('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractLatestToolName
// ---------------------------------------------------------------------------

describe('extractLatestToolName', () => {
  it('extracts tool_use name from last message', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check...' },
          { type: 'tool_use', name: 'exec', id: '1', input: {} },
        ],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('exec');
  });

  it('returns the LAST tool_use when multiple exist', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'read', id: '1', input: {} },
          { type: 'tool_use', name: 'write', id: '2', input: {} },
        ],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('write');
  });

  it('scans messages from end to beginning', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'read', id: '1', input: {} }],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'exec', id: '2', input: {} }],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('exec');
  });

  it('handles toolcall type variant', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'toolcall', name: 'web_search' }],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('web_search');
  });

  it('handles tool_call type variant', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_call', name: 'browser' }],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('browser');
  });

  it('returns undefined for text-only messages', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
    ];
    expect(extractLatestToolName(messages)).toBeUndefined();
  });

  it('returns undefined for empty messages', () => {
    expect(extractLatestToolName([])).toBeUndefined();
  });

  it('returns undefined for string content', () => {
    const messages = [{ role: 'assistant', content: 'just text' }];
    expect(extractLatestToolName(messages)).toBeUndefined();
  });

  it('returns undefined for messages without content', () => {
    const messages = [{ role: 'system' }];
    expect(extractLatestToolName(messages)).toBeUndefined();
  });
  it('handles tooluse/ type variant', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tooluse', name: 'memory_search' }],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('memory_search');
  });

  it('skips non-tool blocks and finds tool_use later in content', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'thinking', text: '...' },
          { type: 'tool_use', name: 'nodes', id: '1', input: {} },
        ],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('nodes');
  });

  it('ignores blocks without name property', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use' }],
      },
    ];
    expect(extractLatestToolName(messages)).toBeUndefined();
  });

  it('extracts toolName from toolResult role messages', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'toolCall', name: 'exec', id: '1' }] },
      { role: 'toolResult', toolCallId: '1', toolName: 'exec', content: 'output...' },
    ];
    expect(extractLatestToolName(messages)).toBe('exec');
  });

  it('handles toolCall camelCase type (gateway native format)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running...' },
          { type: 'toolCall', name: 'read', id: 'toolu_abc' },
        ],
      },
    ];
    expect(extractLatestToolName(messages)).toBe('read');
  });

  it('prefers latest toolResult over earlier toolCall', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'toolCall', name: 'read', id: '1' }],
      },
      { role: 'toolResult', toolCallId: '1', toolName: 'read', content: '...' },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', name: 'exec', id: '2' }],
      },
      { role: 'toolResult', toolCallId: '2', toolName: 'exec', content: '...' },
    ];
    // Scanning from end: last toolResult has toolName=exec
    expect(extractLatestToolName(messages)).toBe('exec');
  });

  it('finds toolResult even when surrounded by text messages', () => {
    const messages = [
      { role: 'user', content: 'do something' },
      { role: 'toolResult', toolCallId: '1', toolName: 'web_search', content: 'results...' },
      { role: 'assistant', content: 'Here are the results' },
    ];
    // Last message is text-only, but toolResult before it has toolName
    expect(extractLatestToolName(messages)).toBe('web_search');
  });
});
