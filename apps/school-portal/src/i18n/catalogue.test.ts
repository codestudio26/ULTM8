import { describe, expect, it } from '@jest/globals';
import { lookup, type Message, type MessageTree } from '@ultm8/i18n';
import { messages as english } from './messages/en-GB';
import { LOCALE_LOADERS } from './locales';

/** Every English text in every language (Decisions 273, 323), with the same
 * placeholders and every plural form the language needs, so nothing falls
 * back to English, loses a `{name}`, or reads wrong for some counts. The
 * API's own error messages are checked in apps/api
 * (server-messages-translated.spec.ts). */

function keys(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' || typeof (v as { other?: unknown }).other === 'string' ? [prefix + k] : keys(v as MessageTree, `${prefix}${k}.`),
  );
}

const placeholders = (m: Message) =>
  [...new Set([...(typeof m === 'string' ? m : Object.values(m).join(' ')).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].sort();

/** The plural forms a language uses for the counts a screen can show. Spanish,
 * French, Italian and Portuguese also have a "many" form, but only for round
 * millions, which falls back to "other" correctly. */
function pluralForms(locale: string): string[] {
  const rules = new Intl.PluralRules(locale);
  return [...new Set(Array.from({ length: 201 }, (_, n) => rules.select(n)))].sort();
}

const englishKeys = keys(english as unknown as MessageTree);

describe('translations', () => {
  it('has English text', () => {
    expect(englishKeys.length).toBeGreaterThan(1000);
  });

  for (const code of Object.keys(LOCALE_LOADERS)) {
    it(`${code} has every English key, with the same placeholders and all plural forms`, async () => {
      const catalogue = (await LOCALE_LOADERS[code]()) as unknown as MessageTree;
      const forms = pluralForms(code);
      const missing: string[] = [];
      const wrongPlaceholders: string[] = [];
      const missingForms: string[] = [];
      for (const key of englishKeys) {
        const text = lookup(catalogue, key);
        const en = lookup(english as unknown as MessageTree, key)!;
        if (text === undefined) {
          missing.push(key);
          continue;
        }
        if (JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(en))) wrongPlaceholders.push(key);
        if (typeof en !== 'string') {
          const lacking = forms.filter((f) => typeof text === 'string' || !(f in text));
          if (lacking.length) missingForms.push(`${key} [${lacking.join(', ')}]`);
        }
      }
      expect(missing).toEqual([]);
      expect(wrongPlaceholders).toEqual([]);
      expect(missingForms).toEqual([]);
    });
  }
});
