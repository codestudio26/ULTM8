import { SERVER_KEY_LOADERS, createEnglishServerTextTranslator, createServerTextTranslator, formatInstant, formatWhen } from '@ultm8/i18n';
import { noticeWallTime } from './notice-time';

/**
 * Decision 434 (TXT-3): notices store a class's date and time as the class's
 * wall time in machine form, and each reader's app formats it in their own
 * language; notices written before keep their English text.
 */
function lookup(tree: unknown, key: string): string | undefined {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree) as string | undefined;
}

async function translatorFor(locale: string) {
  const server = await SERVER_KEY_LOADERS[locale]();
  const t = (key: string, vars?: Record<string, string | number>) => {
    const template = lookup({ server }, key) ?? key;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`));
  };
  return createServerTextTranslator(t, locale, undefined);
}

describe('noticeWallTime (Decision 434, TXT-3)', () => {
  const at = new Date('2026-11-12T16:00:00.000Z');

  it("is the class's own wall time, YYYY-MM-DD HH:mm", () => {
    expect(noticeWallTime(at, 'Asia/Dubai')).toBe('2026-11-12 20:00');
    expect(noticeWallTime(at, 'Asia/Kolkata')).toBe('2026-11-12 21:30');
    expect(noticeWallTime(at, 'America/Sao_Paulo')).toBe('2026-11-12 13:00');
  });

  it('a zone that can\'t be read gives UTC, marked', () => {
    expect(noticeWallTime(at, 'Mountain Standard Time')).toBe('2026-11-12 16:00 UTC');
  });
});

describe('formatWhen in the apps (Decision 434, TXT-3)', () => {
  it("formats the machine form in the reader's language, without shifting it", () => {
    expect(formatWhen('2026-11-12 20:00', 'en-GB')).toMatch(/^Thu,? 12 Nov 2026,? 20:00$/);
    expect(formatWhen('2026-11-12 20:00', 'en-US')).toMatch(/^Thu, Nov 12, 2026, 8:00\sPM$/);
    expect(formatWhen('2026-11-12 20:00', 'ar')).not.toContain('2026-11-12');
    expect(formatWhen('2026-11-12 16:00 UTC', 'de')).toMatch(/UTC$/);
  });

  it('leaves older English text as it was', () => {
    expect(formatWhen('Thu, 12 Nov 2026, 20:00', 'ar')).toBe('Thu, 12 Nov 2026, 20:00');
    expect(formatWhen('Monday 9 Nov at 21:30', 'ja')).toBe('Monday 9 Nov at 21:30');
  });

  it('every class notice shape gets its date in the reader\'s language', async () => {
    const ar = await translatorFor('ar');
    const bodies = [
      'Sparring on 2026-11-12 20:00 has been cancelled by the school.',
      'Sparring on 2026-11-12 20:00 has been cancelled by the school. Reason: Eid',
      'Sparring has moved to 2026-11-12 20:00. Bookings moved with it.',
      'Sparring has moved to 2026-11-12 20:00. Your waitlist place moved with it.',
      'Sparring on 2026-11-12 20:00 was cancelled by your School. Any class credit you used has been given back.',
      'Open mat at Dubai on 2026-11-12 20:00, for 60 minutes. Book in the app to join.',
      'Open mat (BJJ) at Dubai on 2026-11-12 20:00, for 60 minutes. Book in the app to join.',
    ];
    for (const body of bodies) {
      const out = ar.notification({ title: 'x', body, type: null }).body;
      expect(out).not.toContain('2026-11-12 20:00');
      expect(out).toContain(formatWhen('2026-11-12 20:00', 'ar'));
    }
    // An older notice keeps its English date, inside the translated sentence.
    expect(ar.notification({ title: 'x', body: 'Sparring has moved to Monday 9 Nov at 21:30. Bookings moved with it.', type: null }).body).toContain('Monday 9 Nov at 21:30');
  });

  it('English readers see the date formatted for English (UK) or (US); a broadcast is left alone', () => {
    const body = 'For Ana: Sparring on 2026-11-12 20:00 has been cancelled by the school.';
    expect(createEnglishServerTextTranslator('en-GB').notification({ title: 'Class cancelled', body, type: 'CLASS_CANCELLED' }).body).toMatch(
      /^For Ana: Sparring on Thu,? 12 Nov 2026,? 20:00 has been cancelled by the school\.$/,
    );
    expect(createEnglishServerTextTranslator('en-US').notification({ title: 'Class cancelled', body, type: 'CLASS_CANCELLED' }).body).toMatch(/Nov 12, 2026, 8:00\sPM/);
    const broadcast = { title: 'Gala', body: 'See you 2026-11-12 20:00!', type: 'SCHOOL_BROADCAST' };
    expect(createEnglishServerTextTranslator('en-US').notification(broadcast).body).toBe('See you 2026-11-12 20:00!');
    expect(createEnglishServerTextTranslator('en-GB').error(400, '', 'Nope.')).toBe('Nope.');
  });
});

describe('formatInstant: the account-deletion date in the reader\'s own time zone (Decision 441 item 9)', () => {
  it('shifts the UTC moment to the reader\'s zone and drops "UTC"', () => {
    expect(formatInstant('2026-12-06 17:14 UTC', 'pt-BR', 'America/Sao_Paulo')).toMatch(/^dom\., 6 de dez\. de 2026,? 14:14$/);
    expect(formatInstant('2026-12-06 17:14 UTC', 'en-GB', 'Asia/Tokyo')).toMatch(/^Mon,? 7 Dec 2026,? 0?2:14$/);
    expect(formatInstant('2026-12-06 17:14 UTC', 'en-GB', 'Asia/Tokyo')).not.toContain('UTC');
  });

  it('uses the zone the device is set to when none is given', () => {
    const own = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
      new Date('2026-12-06T17:14:00.000Z'),
    );
    expect(formatInstant('2026-12-06 17:14 UTC', 'en-GB')).toBe(own);
  });

  it('anything that is not a UTC moment is shown as formatWhen shows it', () => {
    expect(formatInstant('2026-11-12 20:00', 'en-GB', 'Asia/Tokyo')).toBe(formatWhen('2026-11-12 20:00', 'en-GB'));
    expect(formatInstant('Sun, 6 Dec 2026, 17:14 UTC', 'de')).toBe('Sun, 6 Dec 2026, 17:14 UTC');
    expect(formatInstant('2026-12-06 17:14 UTC', 'de', 'Not/AZone')).toBe(formatWhen('2026-12-06 17:14 UTC', 'de'));
  });

  it('the deletion notice is translated with the local date, in every language and in English', async () => {
    const body = 'Your ULTM8 account will be deleted on 2026-12-06 17:14 UTC. Until then it is locked. To keep it, sign in again before then.';
    const local = formatInstant('2026-12-06 17:14 UTC', 'pt-BR');
    const pt = (await translatorFor('pt-BR')).notification({ title: 'Account deletion requested', body, type: 'ACCOUNT_DELETION' }).body;
    expect(pt).toContain(local);
    expect(pt).not.toContain('UTC');
    const children = 'Your ULTM8 account will be deleted on 2026-12-06 17:14 UTC. Until then it is locked. These children\'s accounts will be deleted with it: Ana Silva. To keep it, sign in again before then.';
    expect((await translatorFor('pt-BR')).notification({ title: 'x', body: children, type: 'ACCOUNT_DELETION' }).body).toContain(local);
    const en = createEnglishServerTextTranslator('en-GB').notification({ title: 'Account deletion requested', body, type: 'ACCOUNT_DELETION' }).body;
    expect(en).toBe(`Your ULTM8 account will be deleted on ${formatInstant('2026-12-06 17:14 UTC', 'en-GB')}. Until then it is locked. To keep it, sign in again before then.`);
    // Other notices keep a class's "UTC" fallback as before.
    expect(createEnglishServerTextTranslator('en-GB').notification({ title: 'x', body: 'Sparring on 2026-11-12 16:00 UTC has been cancelled by the school.', type: null }).body).toMatch(/UTC has been/);
  });
});
