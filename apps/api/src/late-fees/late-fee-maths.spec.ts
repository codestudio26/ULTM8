import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { firstLateDay, isLateFeeDue, lateFeeAmount } from './late-fee-maths';
import { lateFeeForChargeNotice, lateFeeForRenewalNotice, lateFeeWaivedNotice } from './late-fee-notices';

describe('late fee maths (Decision 413)', () => {
  it('a fixed fee is the fixed amount, whatever is owed', () => {
    expect(lateFeeAmount({ type: 'FIXED', fixedAmount: 1500 }, 1)).toBe(1500);
    expect(lateFeeAmount({ type: 'FIXED', fixedAmount: 1500 }, 999_999)).toBe(1500);
  });

  it('a % is of what is still owed, rounded half up to the minor unit', () => {
    expect(lateFeeAmount({ type: 'PERCENT', percentBps: 200 }, 10000)).toBe(200); // 2% of 100.00
    expect(lateFeeAmount({ type: 'PERCENT', percentBps: 250 }, 4321)).toBe(108); // 2.5% of 43.21 = 1.08025
    expect(lateFeeAmount({ type: 'PERCENT', percentBps: 1050 }, 3330)).toBe(350); // 10.5% of 33.30 = 3.4965
    expect(lateFeeAmount({ type: 'PERCENT', percentBps: 500 }, 10)).toBe(1); // 0.5 rounds up
    expect(lateFeeAmount({ type: 'PERCENT', percentBps: 10000 }, 7000)).toBe(7000); // 100%
  });

  it('nothing owed, or a % that rounds to nothing, is no fee', () => {
    expect(lateFeeAmount({ type: 'FIXED', fixedAmount: 1500 }, 0)).toBe(0);
    expect(lateFeeAmount({ type: 'PERCENT', percentBps: 100 }, 49)).toBe(0); // 0.49 → 0
  });

  it('the fee comes the day after the grace days', () => {
    expect(firstLateDay('2026-11-01', 0)).toBe('2026-11-02');
    expect(firstLateDay('2026-11-01', 3)).toBe('2026-11-05');
    expect(firstLateDay('2026-12-30', 3)).toBe('2027-01-03');
    expect(firstLateDay('2028-02-28', 1)).toBe('2028-03-01'); // leap year
  });

  it('is due once the grace days have passed, and only if they ended while late fees were on', () => {
    expect(isLateFeeDue('2026-11-01', 3, '2026-11-04', '2026-10-01')).toBe(false); // still in grace
    expect(isLateFeeDue('2026-11-01', 3, '2026-11-05', '2026-10-01')).toBe(true);
    expect(isLateFeeDue('2026-11-01', 3, '2026-12-25', '2026-10-01')).toBe(true); // still unpaid later: still due (one fee, guarded elsewhere)
    expect(isLateFeeDue('2026-11-01', 3, '2026-11-20', '2026-11-05')).toBe(true); // switched on the day it became late
    expect(isLateFeeDue('2026-11-01', 3, '2026-11-20', '2026-11-06')).toBe(false); // already late before: never retroactive
  });
});

describe('late fee notices, translated (Decision 413 item 8)', () => {
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

  it('each shape has a title and a body rule, and reads in Portuguese', async () => {
    const added = lateFeeForChargeNotice(1250, 'BRL', '#0000003', 'Rash guard');
    expect(added.body).toBe('A late fee of 12.50 BRL was added to your balance because invoice #0000003 (Rash guard) is overdue. Pay it in the app or at the front desk.');
    const renewal = lateFeeForRenewalNotice(300, 'GBP', 'Monthly', 6000, 'GBP');
    const waived = lateFeeWaivedNotice(1250, 'BRL', 0);
    const waivedCredit = lateFeeWaivedNotice(1250, 'BRL', 500);
    const notices = [added, renewal, waived, waivedCredit];

    const english = translatorFor(serverKeys);
    for (const n of notices) {
      const out = english.notification({ ...n, type: 'CHARGE' });
      expect(out.title).toBe(n.title);
      expect(out.body).not.toContain('server.notifications');
    }

    const ptKeys = await SERVER_KEY_LOADERS['pt-BR']();
    const pt = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...ptKeys.notifications } });
    const [a, r, w, wc] = notices.map((n) => pt.notification({ ...n, type: 'CHARGE' }));
    expect(a.title).toBe('Multa por atraso adicionada');
    expect(a.body).toMatch(/^Uma multa por atraso de .*12,50 foi adicionada ao seu saldo porque a fatura #0000003 \(Rash guard\) está vencida\./);
    expect(r.body).toContain('Monthly');
    expect(r.body).toContain('60,00');
    expect(w.title).toBe('Multa por atraso dispensada');
    expect(w.body).toContain('12,50');
    expect(wc.body).toContain('5,00');
    // A Guardian's copy.
    const forChild = pt.notification({ title: added.title, body: `For Kai: ${added.body}`, type: 'CHARGE' });
    expect(forChild.body).toContain('Kai');
    expect(forChild.body).toContain('#0000003');
  });
});
