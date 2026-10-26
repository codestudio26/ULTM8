import { describe, expect, it } from '@jest/globals';
import { lookup, type Message, type MessageTree } from '@ultm8/i18n';
import { messages as english } from './messages/en';
import { LOCALE_LOADERS } from './locales';

/** Every English text in every language (Decision 323), with the same
 * placeholders, so nothing falls back to English or loses a `{name}`. */

function keys(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' || typeof (v as { other?: unknown }).other === 'string' ? [prefix + k] : keys(v as MessageTree, `${prefix}${k}.`),
  );
}

const placeholders = (m: Message) =>
  [...new Set([...(typeof m === 'string' ? m : Object.values(m).join(' ')).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].sort();

const englishKeys = keys(english as unknown as MessageTree);

describe('translations', () => {
  it('has English text', () => {
    expect(englishKeys.length).toBeGreaterThan(100);
  });

  for (const code of Object.keys(LOCALE_LOADERS)) {
    it(`${code} has every English key, with the same placeholders`, async () => {
      const catalogue = await LOCALE_LOADERS[code]();
      const missing: string[] = [];
      const wrong: string[] = [];
      for (const key of englishKeys) {
        const text = lookup(catalogue, key);
        if (text === undefined) missing.push(key);
        else if (JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(lookup(english, key)!))) wrong.push(key);
      }
      expect(missing).toEqual([]);
      expect(wrong).toEqual([]);
    });
  }
});
