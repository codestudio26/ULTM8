import { describe, expect, it } from '@jest/globals';
import { lookup, type Message, type MessageTree } from '@ultm8/i18n';
import { messages as english } from './messages/en';
import { LOCALE_LOADERS } from './locales';

/** Jest can't run the app's `import()` loaders, so each file is read directly;
 * the `server` group is shared from @ultm8/i18n and checked with the portal. */
const catalogueOf = (code: string) => (require(`./messages/${code}`) as { messages: MessageTree }).messages;

/** Every English text in every language (Decision 323), with the same
 * placeholders, so nothing falls back to English or loses a `{name}`. */

function keys(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' || typeof (v as { other?: unknown }).other === 'string' ? [prefix + k] : keys(v as MessageTree, `${prefix}${k}.`),
  );
}

const placeholders = (m: Message) =>
  [...new Set([...(typeof m === 'string' ? m : Object.values(m).join(' ')).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].sort();

const { server: _server, ...screens } = english;
const englishKeys = keys(screens as unknown as MessageTree);

describe('translations', () => {
  it('has English text', () => {
    expect(englishKeys.length).toBeGreaterThan(100);
  });

  for (const code of Object.keys(LOCALE_LOADERS)) {
    it(`${code} has every English key, with the same placeholders`, () => {
      const catalogue = catalogueOf(code);
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
