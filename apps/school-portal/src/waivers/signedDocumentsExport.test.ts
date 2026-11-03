import { describe, expect, it } from '@jest/globals';
import { lookup, type MessageTree } from '@ultm8/i18n';
import { messages as english } from '../i18n/messages/en-GB';
import type { TranslateFn } from '../i18n/I18nProvider';
import { exportReadyText, exportRequestBody, mayIncludeMemberFiles } from './signedDocumentsExport';

/** A stand-in for useT: the English text with its placeholders filled in. */
const t = ((key: string, params: Record<string, string | number> = {}) => {
  const text = lookup(english as unknown as MessageTree, key);
  if (typeof text !== 'string') throw new Error(`No English text for ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
}) as unknown as TranslateFn;

const labels = { member: 'Member' };

/** Decision 422 item 9: the export dialog's "Include member files" tick box. */
describe('the export dialog and member files', () => {
  it('shows the tick box only to an owner of this School', () => {
    expect(mayIncludeMemberFiles(['school-a'], 'school-a')).toBe(true);
    expect(mayIncludeMemberFiles(['school-b', 'school-a'], 'school-a')).toBe(true);
    // Staff own no School; an owner of another School doesn't own this one.
    expect(mayIncludeMemberFiles([], 'school-a')).toBe(false);
    expect(mayIncludeMemberFiles(['school-b'], 'school-a')).toBe(false);
    expect(mayIncludeMemberFiles(['school-a'], '')).toBe(false);
  });

  it('asks for member files only when the box was shown and ticked, and is off by default', () => {
    expect(exportRequestBody(labels, { mayIncludeMemberFiles: true, includeMemberFiles: true })).toEqual({ labels, includeMemberFiles: true });
    expect(exportRequestBody(labels, { mayIncludeMemberFiles: true, includeMemberFiles: false })).toEqual({ labels, includeMemberFiles: false });
    expect(exportRequestBody(labels, { mayIncludeMemberFiles: false, includeMemberFiles: true })).toEqual({ labels, includeMemberFiles: false });
  });

  it('counts the member files in the "Ready" line when the export has them', () => {
    expect(exportReadyText(t, { documentCount: 5, includeMemberFiles: true, memberFileCount: 3 }, '2 MB')).toBe('Ready. Documents: 5. Member files: 3. Size: 2 MB.');
    expect(exportReadyText(t, { documentCount: 5, includeMemberFiles: false, memberFileCount: null }, '2 MB')).toBe('Ready. Documents: 5. Size: 2 MB.');
    expect(exportReadyText(t, { documentCount: null, includeMemberFiles: true, memberFileCount: null }, '1 KB')).toBe('Ready. Documents: 0. Member files: 0. Size: 1 KB.');
  });

  it('has English text for the tick box and its hint', () => {
    expect(t('waivers.exportAll.includeMemberFiles' as Parameters<TranslateFn>[0])).toBe('Include member files');
    expect(t('waivers.exportAll.includeMemberFilesHint' as Parameters<TranslateFn>[0])).toContain('member-files');
  });
});
