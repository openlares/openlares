'use client';

import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from 'react';
import type { ChatMessage } from '@openlares/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatProps {
  /** Chat messages to display. */
  messages: ChatMessage[];
  /** Whether an assistant response is currently streaming. */
  isStreaming: boolean;
  /** Whether the gateway is connected. */
  isConnected: boolean;
  /** Called when the user submits a message. */
  onSendMessage: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-6 py-3">
      <span className="text-xs text-gray-500">Agent is typing</span>
      <span className="flex gap-0.5">
        <span
          className="h-1.5 w-1.5 rounded-full bg-amber-400 opacity-75"
          style={{ animation: 'pulse 1.4s ease-in-out infinite' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-amber-400 opacity-75"
          style={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-amber-400 opacity-75"
          style={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }}
        />
      </span>
    </div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`px-6 py-4 ${isUser ? 'rounded-lg bg-gray-800' : ''}`}>
      <span className={`text-xs font-medium ${isUser ? 'text-gray-400' : 'text-amber-400'}`}>
        {isUser ? 'You' : 'Agent'}
      </span>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
        {message.content}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Chat — conversational message interface with streaming support.
 *
 * Presentational component that receives messages and callbacks as props.
 * Full-width messages with alternating backgrounds, streaming indicator,
 * and a text input at the bottom.
 */
export function Chat({ messages, isStreaming, isConnected, onSendMessage }: ChatProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    onSendMessage(text);
    setInput('');
  }, [input, isStreaming, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Not connected state
  if (!isConnected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-gray-950 text-sm text-gray-500">
        <p>Connect to start chatting</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-gray-950">
      {/* Message area */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-600">
            Send a message to start
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageItem key={i} message={msg} />
        ))}

        {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && <TypingIndicator />}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-800 bg-gray-900 p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-amber-600 disabled:opacity-50 disabled:hover:bg-amber-500"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
