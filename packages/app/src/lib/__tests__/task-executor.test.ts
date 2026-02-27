import { describe, it, expect } from 'vitest';
import {
  extractContent,
  parseMoveDirective,
  extractResponseText,
} from '../task-executor';

describe('extractContent', () => {
  it('returns string content as-is', () => {
    expect(extractContent('Hello world')).toBe('Hello world');
  });

  it('extracts text from content blocks array', () => {
    const blocks = [
      { type: 'text', text: 'First part' },
      { type: 'text', text: 'Second part' },
    ];
    expect(extractContent(blocks)).toBe('First part\nSecond part');
  });

  it('skips non-text blocks', () => {
    const blocks = [
      { type: 'thinking', text: 'internal thought' },
      { type: 'text', text: 'visible output' },
    ];
    expect(extractContent(blocks)).toBe('visible output');
  });

  it('returns empty string for null/undefined/number', () => {
    expect(extractContent(null)).toBe('');
    expect(extractContent(undefined)).toBe('');
    expect(extractContent(42)).toBe('');
  });
});

describe('parseMoveDirective', () => {
  it('parses simple MOVE TO', () => {
    expect(parseMoveDirective('Task done.\nMOVE TO: Done')).toBe('Done');
  });

  it('parses case-insensitive', () => {
    expect(parseMoveDirective('move to: Review')).toBe('Review');
  });

  it('handles extra whitespace', () => {
    expect(parseMoveDirective('MOVE TO:   In Progress  ')).toBe('In Progress');
  });

  it('returns null when no directive', () => {
    expect(parseMoveDirective('Just a regular message')).toBeNull();
  });

  it('strips trailing JSON garbage from content blocks', () => {
    // This is the actual bug: JSON.stringify of content blocks produces
    // [{"type":"text","text":"...MOVE TO: Done"}]
    // The regex matched Done"}] as the queue name
    expect(parseMoveDirective('Pipeline healthy.\nMOVE TO: Done"}]')).toBe('Done');
  });

  it('strips trailing punctuation and brackets', () => {
    expect(parseMoveDirective('MOVE TO: Done"')).toBe('Done');
    expect(parseMoveDirective('MOVE TO: Done}')).toBe('Done');
    expect(parseMoveDirective('MOVE TO: Done]')).toBe('Done');
    expect(parseMoveDirective('MOVE TO: Done.)\n')).toBe('Done');
  });

  it('preserves hyphens and underscores in queue names', () => {
    expect(parseMoveDirective('MOVE TO: needs-review')).toBe('needs-review');
    expect(parseMoveDirective('MOVE TO: code_review')).toBe('code_review');
  });

  it('handles STUCK', () => {
    expect(parseMoveDirective('Cannot proceed.\nMOVE TO: STUCK')).toBe('STUCK');
  });

  it('handles DONE', () => {
    expect(parseMoveDirective('All finished.\nMOVE TO: DONE')).toBe('DONE');
  });

  it('handles multiline content with MOVE TO in the middle', () => {
    const content = 'Line 1\nMOVE TO: Review\nLine 3';
    expect(parseMoveDirective(content)).toBe('Review');
  });
});

describe('extractResponseText', () => {
  it('extracts text before MOVE TO from string', () => {
    expect(extractResponseText('Task done.\nMOVE TO: Done')).toBe('Task done.');
  });

  it('extracts text before MOVE TO from content blocks', () => {
    const blocks = [
      { type: 'text', text: 'Analysis complete.\nMOVE TO: Done' },
    ];
    expect(extractResponseText(blocks)).toBe('Analysis complete.');
  });

  it('returns null for empty result after stripping', () => {
    expect(extractResponseText('MOVE TO: Done')).toBeNull();
  });

  it('handles content with no MOVE TO', () => {
    expect(extractResponseText('Just a regular message')).toBe('Just a regular message');
  });

  it('returns null for non-string non-array', () => {
    expect(extractResponseText(42)).toBeNull();
    expect(extractResponseText(null)).toBeNull();
  });
});
