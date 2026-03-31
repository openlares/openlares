'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersonaFields } from '@openlares/core';
import { parseIdentityFile, reassembleIdentityFile, type ParsedIdentity } from './field-detector';
import { gatewayStore } from '@openlares/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentInfo {
  agentId: string;
  name?: string;
}

type FieldKey = keyof PersonaFields;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ---------------------------------------------------------------------------
// Persona Editor
// ---------------------------------------------------------------------------

export function PersonaEditor() {
  // ---- Agents list ----
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsError, setAgentsError] = useState('');

  // ---- Selected agent + file ----
  const [selectedAgent, setSelectedAgent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);

  // ---- Parsed state ----
  const [fields, setFields] = useState<Partial<PersonaFields>>({});
  const [freeText, setFreeText] = useState('');
  const [parsed, setParsed] = useState<ParsedIdentity | null>(null);
  const originalContentRef = useRef('');

  // ---- Save state ----
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // ---- Fetch agents on mount ----
  useEffect(() => {
    let cancelled = false;
    async function fetchAgents() {
      try {
        const data = await gatewayStore.getState().listAgents();
        if (!cancelled) {
          // Deduplicate by agentId (gateway may return duplicates)
          const seen = new Set<string>();
          const unique = data.filter((a) => {
            if (seen.has(a.agentId)) return false;
            seen.add(a.agentId);
            return true;
          });
          setAgents(unique);
          setAgentsError('');
        }
      } catch (e) {
        if (!cancelled) setAgentsError(String(e));
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    }
    void fetchAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Load IDENTITY.md when agent changes ----
  const loadFile = useCallback(async (agentId: string) => {
    if (!agentId) return;
    setLoadingFile(true);
    setSaveStatus('idle');
    try {
      const content = await gatewayStore.getState().getAgentFile(agentId, 'IDENTITY.md');
      originalContentRef.current = content;
      const p = parseIdentityFile(content);
      setParsed(p);
      setFields(p.fields);
      setFreeText(p.freeText);
    } catch {
      setParsed(null);
      setFields({});
      setFreeText('');
      originalContentRef.current = '';
    } finally {
      setLoadingFile(false);
    }
  }, []);

  const handleAgentChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      setSelectedAgent(id);
      void loadFile(id);
    },
    [loadFile],
  );

  // ---- Field updates ----
  const updateField = useCallback((key: FieldKey, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setSaveStatus('idle');
  }, []);

  // ---- Save ----
  const handleSave = useCallback(async () => {
    if (!selectedAgent) return;
    setSaveStatus('saving');
    try {
      const content = parsed
        ? reassembleIdentityFile(originalContentRef.current, parsed, fields, freeText)
        : buildFreshIdentity(fields, freeText);

      await gatewayStore.getState().setAgentFile(selectedAgent, 'IDENTITY.md', content);
      // Update original content so subsequent saves work correctly
      originalContentRef.current = content;
      setParsed(parseIdentityFile(content));
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [selectedAgent, parsed, fields, freeText]);

  // ---- Reset ----
  const handleReset = useCallback(() => {
    if (!parsed) return;
    const p = parseIdentityFile(originalContentRef.current);
    setParsed(p);
    setFields(p.fields);
    setFreeText(p.freeText);
    setSaveStatus('idle');
  }, [parsed]);

  // ---- Render ----

  if (loadingAgents) {
    return <div className="text-sm text-gray-400">Loading agents…</div>;
  }

  if (agentsError) {
    return <div className="text-sm text-red-400">Failed to load agents: {agentsError}</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Agent selector */}
      <div>
        <label htmlFor="agent-select" className="mb-1 block text-sm font-medium text-gray-300">
          Agent
        </label>
        <select
          id="agent-select"
          value={selectedAgent}
          onChange={handleAgentChange}
          className="w-full max-w-sm rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none"
        >
          <option value="">Select an agent…</option>
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {a.name ?? a.agentId}
            </option>
          ))}
        </select>
      </div>

      {loadingFile && <div className="text-sm text-gray-400">Loading persona…</div>}

      {selectedAgent && !loadingFile && (
        <>
          {/* Detected fields */}
          <section className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Detected Fields
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldInput
                label="Name"
                value={fields.name ?? ''}
                onChange={(v) => updateField('name', v)}
              />
              <FieldInput
                label="Role"
                value={fields.role ?? ''}
                onChange={(v) => updateField('role', v)}
              />
              <FieldInput
                label="Vibe"
                value={fields.vibe ?? ''}
                onChange={(v) => updateField('vibe', v)}
              />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FieldInput
                    label="Color"
                    value={fields.color ?? ''}
                    onChange={(v) => updateField('color', v)}
                    placeholder="#06b6d4"
                  />
                </div>
                <input
                  type="color"
                  value={fields.color || '#06b6d4'}
                  onChange={(e) => updateField('color', e.target.value)}
                  className="mb-0.5 h-9 w-9 cursor-pointer rounded border border-gray-700 bg-gray-800"
                  title="Pick color"
                />
              </div>
              <FieldInput
                label="Icon"
                value={fields.icon ?? ''}
                onChange={(v) => updateField('icon', v)}
                placeholder="🤖"
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-300">Shape</label>
                <select
                  value={fields.shape ?? 'circle'}
                  onChange={(e) => updateField('shape', e.target.value as PersonaFields['shape'])}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="circle">Circle</option>
                  <option value="rounded-square">Rounded Square</option>
                  <option value="hexagon">Hexagon</option>
                </select>
              </div>
            </div>
          </section>

          {/* Free text */}
          <section className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Additional Content
            </h2>
            <textarea
              value={freeText}
              onChange={(e) => {
                setFreeText(e.target.value);
                setSaveStatus('idle');
              }}
              rows={10}
              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:border-cyan-500 focus:outline-none"
              placeholder="Additional markdown content…"
            />
          </section>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={handleReset}
              className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
            >
              Reset
            </button>
            {saveStatus === 'saved' && <span className="text-sm text-green-400">✓ Saved</span>}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-400">Save failed — check connection</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-300">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none"
      />
    </div>
  );
}

/** Build a fresh IDENTITY.md from scratch (no original content). */
function buildFreshIdentity(fields: Partial<PersonaFields>, freeText: string): string {
  const lines: string[] = ['# IDENTITY.md', ''];
  if (fields.name) lines.push(`- **Name:** ${fields.name}`);
  if (fields.role) lines.push(`- **Role:** ${fields.role}`);
  if (fields.vibe) lines.push(`- **Vibe:** ${fields.vibe}`);
  if (lines.length > 2) lines.push('');
  if (freeText.trim()) {
    lines.push(freeText.trim());
    lines.push('');
  }

  // Visual-only fields
  const blockEntries: string[] = [];
  if (fields.color) blockEntries.push(`color: ${fields.color}`);
  if (fields.icon) blockEntries.push(`icon: ${fields.icon}`);
  if (fields.shape) blockEntries.push(`shape: ${fields.shape}`);
  if (blockEntries.length > 0) {
    lines.push('<!-- openlares:persona');
    lines.push(...blockEntries);
    lines.push('-->');
  }

  return lines.join('\n') + '\n';
}
