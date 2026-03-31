import type { PersonaFields } from '@openlares/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedIdentity {
  fields: Partial<PersonaFields>;
  freeText: string;
  sharedFieldLines: {
    field: 'name' | 'role' | 'vibe';
    lineIndex: number;
    originalLine: string;
  }[];
  personaBlockRange: { start: number; end: number } | null;
}

// ---------------------------------------------------------------------------
// Shared field patterns (case-insensitive)
// ---------------------------------------------------------------------------

type SharedField = 'name' | 'role' | 'vibe';

const SHARED_PATTERNS: { field: SharedField; regex: RegExp }[] = [
  { field: 'name', regex: /^\s*[-*]*\s*\*{0,2}name\*{0,2}\s*[:：]\s*(.+)$/i },
  { field: 'role', regex: /^\s*[-*]*\s*\*{0,2}role\*{0,2}\s*[:：]\s*(.+)$/i },
  {
    field: 'vibe',
    regex: /^\s*[-*]*\s*\*{0,2}(?:vibe|personality)\*{0,2}\s*[:：]\s*(.+)$/i,
  },
];

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const PERSONA_BLOCK_START = /^<!--\s*openlares:persona\b/;
const PERSONA_BLOCK_END = /^-->/;

function parsePersonaBlock(
  lines: string[],
): { fields: Partial<PersonaFields>; start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l != null && PERSONA_BLOCK_START.test(l)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l != null && PERSONA_BLOCK_END.test(l)) {
      end = i;
      break;
    }
  }

  const fields: Partial<PersonaFields> = {};
  for (let i = start + 1; i <= end; i++) {
    const line = lines[i] ?? '';
    const match = line.match(/^\s*(\w+)\s*:\s*(.+)$/);
    if (match) {
      const key = (match[1] ?? '').toLowerCase();
      const value = (match[2] ?? '').trim();
      if (key === 'color') fields.color = value;
      else if (key === 'icon') fields.icon = value;
      else if (key === 'shape' && isValidShape(value)) fields.shape = value;
    }
  }

  return { fields, start, end };
}

function isValidShape(v: string): v is PersonaFields['shape'] {
  return v === 'circle' || v === 'rounded-square' || v === 'hexagon';
}

export function parseIdentityFile(content: string): ParsedIdentity {
  const lines = content.split('\n');

  // Step 1: persona block (visual-only fields)
  const block = parsePersonaBlock(lines);
  const blockFields = block?.fields ?? {};
  const blockRange = block ? { start: block.start, end: block.end } : null;

  // Track which line indexes are consumed
  const consumed = new Set<number>();
  if (blockRange) {
    for (let i = blockRange.start; i <= blockRange.end; i++) consumed.add(i);
  }

  // Step 2: shared fields
  const sharedFieldLines: ParsedIdentity['sharedFieldLines'] = [];
  const sharedValues: Partial<PersonaFields> = {};

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const currentLine = lines[i] ?? '';
    for (const { field, regex } of SHARED_PATTERNS) {
      // Only take the first match per field
      if (sharedValues[field] !== undefined) continue;
      const m = currentLine.match(regex);
      if (m) {
        sharedValues[field] = (m[1] ?? '')
          .replace(/^\*+\s*/, '')
          .replace(/\s*\*+$/, '')
          .trim();
        sharedFieldLines.push({ field, lineIndex: i, originalLine: currentLine });
        consumed.add(i);
        break;
      }
    }
  }

  // Step 3: free text = everything not consumed
  const freeLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!consumed.has(i)) freeLines.push(lines[i] ?? '');
  }
  const freeText = freeLines.join('\n');

  return {
    fields: { ...sharedValues, ...blockFields },
    freeText,
    sharedFieldLines,
    personaBlockRange: blockRange,
  };
}

// ---------------------------------------------------------------------------
// Reassemble
// ---------------------------------------------------------------------------

function buildPersonaBlock(fields: Partial<PersonaFields>): string {
  const entries: string[] = [];
  if (fields.color) entries.push('color: ' + fields.color);
  if (fields.icon) entries.push('icon: ' + fields.icon);
  if (fields.shape) entries.push('shape: ' + fields.shape);
  if (entries.length === 0) return '';
  return '<!-- openlares:persona\n' + entries.join('\n') + '\n-->';
}

export function reassembleIdentityFile(
  originalContent: string,
  parsed: ParsedIdentity,
  updatedFields: Partial<PersonaFields>,
  updatedFreeText: string,
): string {
  const lines = originalContent.split('\n');
  const result: string[] = [];

  // Track indexes that will be replaced or skipped
  const skip = new Set<number>();

  // Mark persona block lines for skip
  if (parsed.personaBlockRange) {
    for (let i = parsed.personaBlockRange.start; i <= parsed.personaBlockRange.end; i++) {
      skip.add(i);
    }
  }

  // Mark shared field lines for skip
  for (const sf of parsed.sharedFieldLines) {
    skip.add(sf.lineIndex);
  }

  // Collect free-text line indexes (everything not consumed)
  const freeLineIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!skip.has(i)) freeLineIndexes.push(i);
  }

  // Split updated free text into lines
  const updatedFreeLines = updatedFreeText.split('\n');

  // Build output line by line
  let freeIdx = 0;
  let personaBlockInserted = false;

  for (let i = 0; i < lines.length; i++) {
    // Persona block range: insert replacement at start position
    if (parsed.personaBlockRange && i === parsed.personaBlockRange.start) {
      const block = buildPersonaBlock(updatedFields);
      if (block) result.push(block);
      personaBlockInserted = true;
      continue;
    }
    if (
      skip.has(i) &&
      parsed.personaBlockRange &&
      i > parsed.personaBlockRange.start &&
      i <= parsed.personaBlockRange.end
    ) {
      continue; // skip rest of old persona block
    }

    // Shared field line: replace with updated value
    const sf = parsed.sharedFieldLines.find((s) => s.lineIndex === i);
    if (sf) {
      const value = updatedFields[sf.field] ?? '';
      // Preserve original formatting style
      const orig = sf.originalLine;
      const replaced = orig.replace(/[:：]\s*.+$/, ': ' + value);
      result.push(replaced);
      continue;
    }

    // Free text line: replace with corresponding updated free text line
    if (freeLineIndexes.includes(i)) {
      if (freeIdx < updatedFreeLines.length) {
        result.push(updatedFreeLines[freeIdx] ?? '');
      }
      freeIdx++;
      continue;
    }

    result.push(lines[i] ?? '');
  }

  // Append any remaining free text lines
  while (freeIdx < updatedFreeLines.length) {
    result.push(updatedFreeLines[freeIdx] ?? '');
    freeIdx++;
  }

  // If no persona block existed, append it
  if (!personaBlockInserted) {
    const block = buildPersonaBlock(updatedFields);
    if (block) {
      result.push('');
      result.push(block);
    }
  }

  return result.join('\n');
}
