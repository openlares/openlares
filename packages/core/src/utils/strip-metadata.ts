/**
 * Strip OpenClaw metadata envelope from user messages.
 *
 * Messages from Discord/Telegram arrive wrapped in a metadata envelope
 * with "Conversation info" and "Sender" JSON blocks. This strips those
 * blocks and returns only the actual user content.
 */
export function stripMetadataEnvelope(content: string): string {
  let remaining = content;

  // Try to strip "Conversation info" block
  const convPattern = /^Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/;
  const convMatch = remaining.match(convPattern);
  if (convMatch) {
    remaining = remaining.slice(convMatch[0].length);
  }

  // Try to strip "Sender" block
  const senderPattern = /^Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/;
  const senderMatch = remaining.match(senderPattern);
  if (senderMatch) {
    remaining = remaining.slice(senderMatch[0].length);
  }

  return remaining.trim();
}
