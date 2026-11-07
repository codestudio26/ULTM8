import { buildIbjjfTemplate, TEMPLATES } from './ibjjf';
import { ENGLISH_TEMPLATE_NAMES, IBJJF_BELT_NAMES, TEMPLATE_NAME_LANGUAGES, templateNamesFor } from './ibjjf-names';

/** Decision 441 item 8: the IBJJF templates' belts in the School's language. */
describe('IBJJF template names', () => {
  it('has its own names for the 14 languages besides English', () => {
    expect([...TEMPLATE_NAME_LANGUAGES].sort()).toEqual(['ar', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'zh-CN']);
  });

  it('English, no language, or an unknown one keeps the template\'s own wording', () => {
    for (const lang of [null, undefined, '', 'en-GB', 'en-US', 'xx']) expect(templateNamesFor(lang)).toBe(ENGLISH_TEMPLATE_NAMES);
    const belts = buildIbjjfTemplate('ibjjf_kids_yellow');
    expect(belts.map((b) => b.name)).toEqual([...IBJJF_BELT_NAMES]);
    expect(belts[0].rungs.map((r) => r.name)).toEqual([
      'White Belt',
      'White Belt · 1 Stripe',
      'White Belt · 2 Stripes',
      'White Belt · 3 Stripes',
      'White Belt · 4 Stripes',
      'White Belt · Red Stripe',
    ]);
    expect(belts[1].rungs.map((r) => r.name).slice(5)).toEqual([
      'Grey/White Belt · 1 Red Stripe',
      'Grey/White Belt · 2 Red Stripes',
      'Grey/White Belt · 3 Red Stripes',
      'Grey/White Belt · 4 Red Stripes',
      'Grey/White Belt · 1 Yellow Stripe',
      'Grey/White Belt · 2 Yellow Stripes',
      'Grey/White Belt · 3 Yellow Stripes',
    ]);
    expect(belts[16].rungs.map((r) => r.name)[6]).toBe('Black Belt · 6 Stripes');
  });

  it('matches the language case-insensitively ("pt-br")', () => {
    expect(templateNamesFor('pt-br').belts['White Belt']).toBe('Faixa Branca');
  });

  it.each(TEMPLATE_NAME_LANGUAGES)('%s: every belt and rung has its own name, different from English, with the same ladder', (lang) => {
    const names = templateNamesFor(lang);
    for (const { id } of TEMPLATES) {
      const english = buildIbjjfTemplate(id);
      const local = buildIbjjfTemplate(id, names);
      expect(local.map((b) => b.rungs.length)).toEqual(english.map((b) => b.rungs.length));
      const beltNames = local.map((b) => b.name);
      expect(new Set(beltNames).size).toBe(beltNames.length);
      for (const [i, b] of local.entries()) {
        expect(b.name.trim()).not.toBe('');
        expect(b.name).not.toBe(english[i].name);
        // Names are unique within a belt, and every numbers/colours field is as in English.
        expect(new Set(b.rungs.map((r) => r.name)).size).toBe(b.rungs.length);
        expect(b.rungs.map(({ name: _n, ...rest }) => rest)).toEqual(english[i].rungs.map(({ name: _n, ...rest }) => rest));
        expect(b.rungs.every((r) => r.name.length <= 100)).toBe(true);
        expect(b.rungs.some((r) => /Stripe|Belt/.test(r.name))).toBe(false);
      }
    }
  });

  it('pt-BR uses "Faixa" and "Grau", as in Brazil', () => {
    const belts = buildIbjjfTemplate('ibjjf', templateNamesFor('pt-BR'));
    expect(belts[0].rungs.map((r) => r.name).slice(0, 3)).toEqual(['Faixa Branca', 'Faixa Branca · 1 Grau', 'Faixa Branca · 2 Graus']);
    expect(belts[13].name).toBe('Faixa Azul');
  });

  it('Polish and Russian use the plural forms for 1, 2–4 and 5+', () => {
    expect(templateNamesFor('pl').stripes(1)).toBe('1 belka');
    expect(templateNamesFor('pl').stripes(3)).toBe('3 belki');
    expect(templateNamesFor('pl').stripes(5)).toBe('5 belek');
    expect(templateNamesFor('ru').stripes(6)).toBe('6 полосок');
  });
});
