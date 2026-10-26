import { describe, expect, it } from 'vitest';
import { buildHelpGuide, SUGGESTED_PROMPTS } from './_assistant-guide';
import { DEFAULT_BINDINGS, SHORTCUT_LABELS, formatBinding } from '../src/lib/shortcuts-core';

/**
 * The help guide is the assistant's ground truth — if it drifts from the
 * real shortcut table, Ember would confidently give wrong keybindings.
 */
describe('assistant help guide', () => {
  it('lists every default shortcut with its live label and binding', () => {
    const guide = buildHelpGuide();
    for (const id of Object.keys(DEFAULT_BINDINGS) as Array<keyof typeof DEFAULT_BINDINGS>) {
      const line = `${formatBinding(DEFAULT_BINDINGS[id])} — ${SHORTCUT_LABELS[id]}`;
      expect(guide).toContain(line);
    }
  });

  it('covers every product area the assistant may be asked about', () => {
    const guide = buildHelpGuide();
    for (const section of [
      '### Notes & editor',
      '### Organization',
      '### Planner & reminders',
      '### Files & AI',
      '### Privacy & sharing',
      '### Interface',
      '### Default keyboard shortcuts',
    ]) {
      expect(guide).toContain(section);
    }
  });

  it('states the encryption exclusion so the model never contradicts it', () => {
    expect(buildHelpGuide()).toContain('excluded from search, Ask, AI, and this assistant');
  });

  it('suggests prompts that are all answerable from the guide', () => {
    expect(SUGGESTED_PROMPTS.length).toBeGreaterThan(0);
    expect(SUGGESTED_PROMPTS.length).toBeLessThanOrEqual(4);
    const guide = buildHelpGuide();
    expect(guide).toContain('recurrence');
    expect(guide).toContain('Command palette');
    expect(guide).toContain('end-to-end encryption');
    expect(guide).toContain('Writing streak');
  });
});
