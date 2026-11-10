import { describe, expect, it } from '@jest/globals';
import { browserLocale, resolveLocale } from './locales';

/** Decision 449 item 3: before signing in, with no language chosen in this
 * browser, the portal uses the browser's language when it is one of the 15,
 * else English. */
describe('browserLocale', () => {
  it('matches a language exactly, or by its base language', () => {
    expect(browserLocale(['pt-BR'])).toBe('pt-BR');
    expect(browserLocale(['pt'])).toBe('pt-BR');
    expect(browserLocale(['pt-PT'])).toBe('pt-BR');
    expect(browserLocale(['de-AT'])).toBe('de');
    expect(browserLocale(['zh-CN'])).toBe('zh-CN');
    expect(browserLocale(['ja'])).toBe('ja');
  });

  it("takes the browser's languages in order, skipping ones the portal doesn't have", () => {
    expect(browserLocale(['sv-SE', 'fr-FR', 'de'])).toBe('fr');
  });

  it('reads an English browser, US included, as English (UK): the formatting variant is only a choice', () => {
    expect(browserLocale(['en-US', 'pt-BR'])).toBe('en-GB');
    expect(browserLocale(['en'])).toBe('en-GB');
  });

  it('gives no language when none of the browser\'s is one of the 15, so the portal shows English', () => {
    expect(browserLocale(['sv-SE', 'fi'])).toBeNull();
    expect(browserLocale([])).toBeNull();
    expect(resolveLocale(browserLocale(['sv']))).toBe('en-GB');
  });
});
