import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { newInvoiceNotice } from './recurring-occurrences';

/**
 * The recurring-charge notices (Decision 412) are written in English and
 * translated in the apps by matching their shape (@ultm8/i18n
 * server/translate.ts), as the step 1 charge notices are
 * (charge-notices.spec.ts). These are the exact shapes RecurringChargesService
 * writes; each occurrence's own notice is step 1's "New invoice".
 */
const NOTICES = [
  { title: 'Recurring charge set up', body: 'A recurring charge was set up: Private lesson, 120.00 BRL every week, first on 2026-11-15.' },
  { title: 'Recurring charge set up', body: 'A recurring charge was set up: Private lesson, 120.00 BRL every month, first on 2026-11-15.' },
  { title: 'Recurring charge set up', body: 'A recurring charge was set up: Private lesson, 120.00 BRL every year, first on 2026-11-15.' },
  { title: 'Recurring charge stopped', body: "Your recurring charge 'Private lesson' was stopped. No more invoices will be created for it." },
  { title: 'Recurring charge restarted', body: "Your recurring charge 'Private lesson' was restarted. The next invoice is on 2026-12-15." },
];

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

describe('recurring charge notices are translated (Decision 412)', () => {
  it('an occurrence uses the "New invoice" notice, word for word', () => {
    expect(newInvoiceNotice({ id: 'c1', invoiceNumber: 12, description: 'Rash guard', grossAmount: 12000, currency: 'brl', dueDate: '2026-11-15' })).toEqual({
      key: 'charge-created-c1',
      title: 'New invoice',
      body: 'Invoice #0000012 for Rash guard: 120.00 BRL, due 2026-11-15.',
      targetId: 'c1',
    });
  });

  it('every notice shape has a title and a body rule, in English and Portuguese', async () => {
    const english = translatorFor(serverKeys);
    for (const n of NOTICES) {
      const out = english.notification({ ...n, type: 'CHARGE' });
      expect(out.title).toBe(n.title);
      expect(out.body).not.toContain('server.notifications');
      expect(out.body).toContain('Private lesson');
    }

    const ptKeys = await SERVER_KEY_LOADERS['pt-BR']();
    const pt = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...ptKeys.notifications } });
    const [weekly, monthly, yearly, stopped, restarted] = NOTICES.map((n) => pt.notification({ ...n, type: 'CHARGE' }));
    expect(weekly.title).toBe('Cobrança recorrente criada');
    expect(weekly.body).toMatch(/^Foi criada uma cobrança recorrente: Private lesson, .*120,00 toda semana, a primeira em .+\.$/);
    expect(monthly.body).toContain('todo mês');
    expect(yearly.body).toContain('todo ano');
    expect(stopped).toEqual({ title: 'Cobrança recorrente interrompida', body: "Sua cobrança recorrente 'Private lesson' foi interrompida. Nenhuma outra fatura será criada para ela." });
    expect(restarted.title).toBe('Cobrança recorrente retomada');
    expect(restarted.body).toMatch(/^Sua cobrança recorrente 'Private lesson' foi retomada\. A próxima fatura é em .+\.$/);
    expect(restarted.body).not.toContain('2026-12-15');
  });
});
