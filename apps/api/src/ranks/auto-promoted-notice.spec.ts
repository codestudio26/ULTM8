import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';

/**
 * The coaches' notice for an automatic promotion (Decision 321 item 5,
 * GradingNotificationsProcessor.autoPromoted) is written in English and
 * translated in the apps by matching its shape (@ultm8/i18n
 * server/translate.ts). This is the exact shape the job writes.
 */
const NOTICE = {
  title: 'Promoted automatically',
  body: 'Ana Lima was promoted automatically to Blue Belt (Judo (Kids)).',
  type: 'GRADING_AUTO_PROMOTED',
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

describe('the "promoted automatically" coach notice is translated (Decision 321 item 5)', () => {
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
      expect(out.body).toContain('Judo (Kids)');
    }
  });
});
