import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { CHILD_SIGNED_TITLE, childSignedBody, notifyParentsChildSigned } from './child-signed-notice';

/**
 * Decision 435 item 30: the parents' notice when their child signs a waiver
 * is written in English and translated in the apps by matching its shape
 * (@ultm8/i18n server/translate.ts). This is the exact shape it writes.
 */
const NOTICE = { title: CHILD_SIGNED_TITLE, body: childSignedBody('Ana', 'Adult & Kids waiver', 'Dojo Lima'), type: 'WAIVER_SIGNED_BY_CHILD' };

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

describe('the "your child signed a waiver" notice (Decision 435 item 30)', () => {
  it('English gives the same text back; every other language translates title and body', async () => {
    expect(NOTICE.body).toBe('Ana signed the waiver "Adult & Kids waiver" at Dojo Lima.');
    const english = translatorFor(serverKeys).notification(NOTICE);
    expect(english).toMatchObject({ title: NOTICE.title, body: NOTICE.body });

    for (const [locale, load] of Object.entries(SERVER_KEY_LOADERS)) {
      const keys = await load();
      const out = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }).notification(NOTICE);
      expect([locale, out.title]).not.toEqual([locale, NOTICE.title]);
      expect([locale, out.body]).not.toEqual([locale, NOTICE.body]);
      expect(out.body).toContain('Ana');
      expect(out.body).toContain('Adult & Kids waiver');
      expect(out.body).toContain('Dojo Lima');
    }
  });

  describe('who is told', () => {
    const sig = { id: 'sig1', studentId: 'kid', schoolId: 's1', waiverId: 'w1', signedWaiverTitle: 'Kids waiver' };
    function setup(dateOfBirth: Date | null, guardians: string[]) {
      const addBulk = jest.fn(async () => []);
      const db = {
        user: { findUnique: jest.fn(async () => ({ firstName: 'Ana', dateOfBirth })) },
        school: { findUnique: jest.fn(async () => ({ name: 'Dojo Lima', timezone: 'UTC' })) },
        waiver: { findUnique: jest.fn(async () => ({ title: 'Kids waiver' })) },
        guardianLink: { findMany: jest.fn(async () => guardians.map((guardianId) => ({ guardianId }))) },
      };
      return { addBulk, run: () => notifyParentsChildSigned(db as never, { addBulk } as never, { warn: jest.fn() }, sig) };
    }

    it('each active parent of a child, as a copy about the child', async () => {
      const { addBulk, run } = setup(new Date(Date.now() - 12 * 365 * 86_400_000), ['p1', 'p2']);
      expect(await run()).toBe(2);
      const jobs = (addBulk.mock.calls[0] as unknown as [Array<{ data: Record<string, unknown> }>])[0];
      expect(jobs.map((j) => j.data.userId)).toEqual(['p1', 'p2']);
      expect(jobs[0].data).toMatchObject({
        title: 'Waiver signed by your child',
        body: 'Ana signed the waiver "Kids waiver" at Dojo Lima.',
        guardianCopyOf: 'kid',
        targetType: 'WAIVER',
        targetId: 'w1',
        notificationId: 'waiver-signed-by-child-sig1-p1',
      });
    });

    it('nobody for an adult, or a child with no parent on ULTM8', async () => {
      const adult = setup(new Date(Date.now() - 30 * 365 * 86_400_000), ['p1']);
      expect(await adult.run()).toBe(0);
      expect(adult.addBulk).not.toHaveBeenCalled();
      const alone = setup(new Date(Date.now() - 12 * 365 * 86_400_000), []);
      expect(await alone.run()).toBe(0);
      expect(alone.addBulk).not.toHaveBeenCalled();
    });
  });
});
