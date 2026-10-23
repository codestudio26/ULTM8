import { computeEligibility, flattenLadder, LadderRank, progressBreakdown, requirementFor } from './engine';
import { classMinutes, DEFAULT_LOGGED_MINUTES, isOpenMat } from './hours-trained';

/** Hours trained (Decisions 301, 306): logged, not graded. */
describe('hours trained — pure parts', () => {
  const at = (iso: string) => new Date(iso);

  it('a class adds its scheduled length in whole minutes (90 minutes = 1.5 hours)', () => {
    expect(classMinutes({ startDate: at('2026-10-01T18:00:00Z'), endDate: at('2026-10-01T19:30:00Z') })).toBe(90);
    expect(classMinutes({ startDate: at('2026-10-01T18:00:00Z'), endDate: at('2026-10-01T18:45:29Z') })).toBe(45);
  });

  it('a class with no length (or a bad one) adds nothing', () => {
    expect(classMinutes({ startDate: at('2026-10-01T18:00:00Z'), endDate: at('2026-10-01T18:00:00Z') })).toBe(0);
    expect(classMinutes({ startDate: at('2026-10-01T18:00:00Z'), endDate: at('2026-10-01T17:00:00Z') })).toBe(0);
  });

  it('"Log a class" without a class defaults to 60 minutes', () => {
    expect(DEFAULT_LOGGED_MINUTES).toBe(60);
  });

  it('open mat is the class type "Open mat", ignoring case and outer spaces, and nothing else', () => {
    expect(isOpenMat('Open mat')).toBe(true);
    expect(isOpenMat('OPEN MAT')).toBe(true);
    expect(isOpenMat('  open Mat ')).toBe(true);
    expect(isOpenMat('Open mat session')).toBe(false);
    expect(isOpenMat('Fundamentals')).toBe(false);
    expect(isOpenMat(null)).toBe(false);
    expect(isOpenMat(undefined)).toBe(false);
  });
});

describe('progress breakdown — read off the engine, never a second formula', () => {
  const tier = (t: Partial<LadderRank['stripeTiers'][number]> & { id: string; order: number }): LadderRank['stripeTiers'][number] => ({
    name: t.id,
    timeOnly: false,
    classesRequired: 0,
    minimumDaysInRank: 0,
    eligibleClassTypes: [],
    classCountMode: 'ANY_TYPE',
    classTypeRequirements: [],
    weeklyClassCountCap: null,
    requiredSkillIds: [],
    bookingUnlocksClassTypes: [],
    ...t,
  });
  const ladder = flattenLadder([
    {
      id: 'white',
      order: 0,
      stripeTiers: [
        tier({ id: 'w0', order: 0 }),
        tier({ id: 'w1', order: 1, classesRequired: 40, minimumDaysInRank: 100, requiredSkillIds: ['a', 'b', 'c'] }),
        tier({
          id: 'w2',
          order: 2,
          classCountMode: 'EACH_TYPE',
          eligibleClassTypes: ['F', 'S'],
          classTypeRequirements: [
            { classType: 'F', classesRequired: 20 },
            { classType: 'S', classesRequired: 10 },
          ],
        }),
      ],
    },
    { id: 'black', order: 1, stripeTiers: [tier({ id: 'b0', order: 0, timeOnly: true, minimumDaysInRank: 1000 }), tier({ id: 'b1', order: 1, timeOnly: true, minimumDaysInRank: 1000 })] },
  ]);

  it('classes, days and skills each on their own; the classes % is the overall %', () => {
    const el = computeEligibility(requirementFor(ladder, 'w0'), {
      rankDate: '2026-07-01',
      today: '2026-08-20', // 50 days
      classes: { total: 30, byType: {} },
      signedSkillIds: ['a', 'x'],
    });
    if (!el.hasNext) throw new Error('expected a next rung');
    expect(progressBreakdown(el)).toEqual({
      classes: { counted: 30, required: 40, percent: el.progressPercent, byType: [] },
      days: { elapsed: 50, required: 100, percent: 50 },
      skills: { signedOff: 1, required: 3, percent: 33 },
    });
    expect(el.progressPercent).toBe(75);
  });

  it('"each type" rungs show each type, and the classes % is still the engine\'s capped %', () => {
    const el = computeEligibility(requirementFor(ladder, 'w1'), {
      rankDate: '2026-08-20',
      today: '2026-08-20',
      classes: { total: 44, byType: { F: 40, S: 4 } },
      signedSkillIds: [],
    });
    if (!el.hasNext) throw new Error('expected a next rung');
    const b = progressBreakdown(el)!;
    expect(b.classes).toEqual({
      counted: 44,
      required: 30,
      percent: 80, // (20 + 4) / 30, each type capped at its own number (Decision 171)
      byType: [
        { classType: 'F', required: 20, counted: 40 },
        { classType: 'S', required: 10, counted: 4 },
      ],
    });
    expect(b.classes!.percent).toBe(el.progressPercent);
    expect(b.days).toEqual({ elapsed: 0, required: 0, percent: 100 });
    expect(b.skills).toEqual({ signedOff: 0, required: 0, percent: 100 });
  });

  it('a time-only rung shows days only', () => {
    const el = computeEligibility(requirementFor(ladder, 'b0'), {
      rankDate: '2026-01-01',
      today: '2026-04-11', // 100 days
      classes: { total: 0, byType: {} },
      signedSkillIds: [],
    });
    expect(progressBreakdown(el)).toEqual({ classes: null, days: { elapsed: 100, required: 1000, percent: 10 }, skills: null });
  });

  it('no next rank: no breakdown', () => {
    const el = computeEligibility(requirementFor(ladder, 'b1'), { rankDate: '2026-01-01', today: '2026-01-02', classes: { total: 0, byType: {} }, signedSkillIds: [] });
    expect(progressBreakdown(el)).toBeNull();
  });
});
