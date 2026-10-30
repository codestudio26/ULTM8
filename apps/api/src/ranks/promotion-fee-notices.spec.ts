import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';

/**
 * The owner's notice for a paid promotion fee whose promotion can no longer
 * apply (Decision 414 item 1, PromotionFeeService.notifyOwnersBlocked) is
 * written in English and translated in the apps by matching its shape
 * (@ultm8/i18n server/translate.ts). This is the exact shape the service
 * writes; a reworded notice that no longer matches would show in English.
 */
const NOTICE = {
  title: "Promotion can't apply",
  body: "Ana Lima's fee for Blue Belt (Judo (Kids)) is paid, but the promotion can't apply: their rank or the belt ladder changed since the grade. Cancel the fee (what was paid becomes credit) or grade them again.",
  type: 'GRADING_FEE_BLOCKED',
};

function lookup(tree: unknown, key: string): string | undefined {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree) as string | undefined;
}

function translatorFor(server: unknown) {
  const t = (key: string, vars?: Record<string, string | number>) => {
    const template = lookup({ server }, key) ?? key;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`));
  };
  return createServerTextTranslator(t, 'pt-BR', undefined);
}

describe('the "promotion can\'t apply" owner notice is translated (Decision 414 item 1)', () => {
  it('English gives the same text back; every other language translates title and body', async () => {
    const english = translatorFor(serverKeys).notification(NOTICE);
    expect(english).toMatchObject({ title: NOTICE.title, body: NOTICE.body });

    for (const [locale, load] of Object.entries(SERVER_KEY_LOADERS)) {
      const keys = await load();
      const out = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }).notification(NOTICE);
      expect([locale, out.title]).not.toEqual([locale, NOTICE.title]);
      expect([locale, out.body]).not.toEqual([locale, NOTICE.body]);
      expect(out.body).toContain('Ana Lima');
      expect(out.body).toContain('Blue Belt');
      // A style name with brackets of its own stays whole.
      expect(out.body).toContain('Judo (Kids)');
    }
  });
});
