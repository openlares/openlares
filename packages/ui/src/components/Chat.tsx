'use client';

import { useRef, useState, useCallback, useEffect, type KeyboardEvent } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '@openlares/core';
import { stripMetadataEnvelope } from '@openlares/core';

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
  /** Called when user scrolls to the top (load older messages). */
  onLoadMore?: () => void;
  /** Whether older messages are being loaded. */
  isLoadingMore?: boolean;
  /** Whether there are more messages to load. */
  hasMore?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters to render per message. Prevents browser freeze on huge payloads. */
const MAX_DISPLAY_LENGTH = 2000;

/** Truncation suffix shown when a message is cut. */
const TRUNCATION_NOTICE = '\n\n… (message truncated)';

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

// stripMetadataEnvelope imported from @openlares/api-client

/**
 * Safely extract displayable text from message content.
 */
function renderContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text)
      .join('');
  }
  if (content && typeof content === 'object') {
    if ('text' in content) return String((content as Record<string, unknown>).text);
    if ('content' in content) return renderContent((content as Record<string, unknown>).content);
  }
  return String(content ?? '');
}

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const rawContent = renderContent(message.content);
  const strippedContent = isUser ? stripMetadataEnvelope(rawContent) : rawContent;

  // Truncate very long messages to prevent browser freeze
  const displayContent =
    strippedContent.length > MAX_DISPLAY_LENGTH
      ? strippedContent.slice(0, MAX_DISPLAY_LENGTH) + TRUNCATION_NOTICE
      : strippedContent;

  return (
    <div className={`px-4 py-4 overflow-hidden ${isUser ? 'rounded-lg bg-gray-800' : ''}`}>
      <span className={`text-xs font-medium ${isUser ? 'text-gray-400' : 'text-amber-400'}`}>
        {isUser ? 'You' : 'Agent'}
      </span>
      {isUser ? (
        <p
          className="mt-1 break-words text-sm leading-relaxed text-gray-200"
          style={{ overflowWrap: 'anywhere' }}
        >
          {displayContent}
        </p>
      ) : (
        <div className="mt-1 break-words text-sm leading-relaxed text-gray-200 prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: ({ children, className }) => {
                const isInline = !className;
                return isInline ? (
                  <code className="bg-gray-700 px-1.5 py-0.5 rounded text-amber-200 text-xs">
                    {children}
                  </code>
                ) : (
                  <code className="bg-gray-900 text-gray-200">{children}</code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-gray-900 p-3 rounded-lg overflow-x-auto border border-gray-700">
                  {children}
                </pre>
              ),
              a: ({ children, href }) => (
                <a
                  href={href}
                  className="text-amber-400 hover:text-amber-300 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse border border-gray-600">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-600 bg-gray-800 px-3 py-2 text-left font-medium">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-600 px-3 py-2">{children}</td>
              ),
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function LoadingMoreIndicator() {
  return (
    <div className="flex items-center justify-center py-3">
      <span className="text-xs text-gray-500">Loading older messages…</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Chat — conversational message interface with streaming support.
 *
 * Uses react-virtuoso for reliable scroll behavior with `followOutput`
 * (auto-scroll to new messages). The parent must provide a definite
 * height (e.g. via flex layout).
 */
export function Chat({
  messages,
  isStreaming,
  isConnected,
  onSendMessage,
  onLoadMore,
  isLoadingMore,
  hasMore,
}: ChatProps) {
  const [input, setInput] = useState('');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: 'smooth',
    });
  }, [messages.length]);

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

  if (!isConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gray-950 text-sm text-gray-500">
        <p>Connect to start chatting</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-950">
      {/* Message area — Virtuoso handles scroll + auto-follow */}
      <div className="flex-1 min-h-0">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-600">
            Send a message to start
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={messages}
            followOutput="smooth"
            atBottomStateChange={setAtBottom}
            initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
            className="[&>div]:overflow-x-hidden"
            startReached={() => {
              if (onLoadMore && hasMore && !isLoadingMore) {
                onLoadMore();
              }
            }}
            itemContent={(index, msg) => <MessageItem message={msg} />}
            components={{
              Header: () =>
                isLoadingMore ? (
                  <LoadingMoreIndicator />
                ) : hasMore === false ? (
                  <div className="flex items-center justify-center py-2">
                    <span className="text-xs text-gray-600">Beginning of conversation</span>
                  </div>
                ) : null,
              Footer: () =>
                isStreaming && messages[messages.length - 1]?.role !== 'assistant' ? (
                  <TypingIndicator />
                ) : null,
            }}
          />
        )}
      </div>

      {/* Scroll to latest button */}
      {!atBottom && messages.length > 0 && (
        <div className="flex justify-center py-1">
          <button
            onClick={scrollToBottom}
            className="rounded-full bg-gray-800 border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors shadow-lg"
          >
            ↓ Latest
          </button>
        </div>
      )}

      {/* Input bar — pinned to bottom */}
      <div className="shrink-0 border-t border-gray-800 bg-gray-900 p-3">
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
