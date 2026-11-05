import { ageOn, boardColumn, boardMoveAveraged, computeEligibility, DEFAULT_TICKS, flattenLadder, LadderRank, progressBreakdown, requirementFor, RequirementTicks } from './index';

/** Decision 321: requirement tick boxes, hours, days attended, minimum age
 * and the averaged progress %. */
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
      tier({
        id: 'w1',
        order: 1,
        classesRequired: 40,
        minimumDaysInRank: 180,
        requiredSkillIds: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
        hoursRequired: 50,
        daysAttendedRequired: 20,
        minimumAge: 16,
      }),
    ],
  },
  { id: 'black', order: 1, stripeTiers: [tier({ id: 'b0', order: 0, timeOnly: true, minimumDaysInRank: 100 }), tier({ id: 'b1', order: 1, minimumAge: 30 })] },
]);

const ALL: RequirementTicks = { classes: true, daysInRank: true, skills: true, hours: true, daysAttended: true, minimumAge: true };
const signed = (n: number) => ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].slice(0, n);

describe('Decision 321 — requirement tick boxes', () => {
  it('the default ticks are classes, days in rank and skills: what every style did before', () => {
    expect(DEFAULT_TICKS).toEqual({ classes: true, daysInRank: true, skills: true, hours: false, daysAttended: false, minimumAge: false });
    const req = requirementFor(ladder, 'w0');
    if (req.kind !== 'NEXT') throw new Error();
    expect([req.requiredClasses, req.requiredDays, req.requiredSkillIds.length, req.requiredHours, req.requiredDaysAttended, req.minimumAge]).toEqual([40, 180, 8, 0, 0, null]);
  });

  it('an unticked requirement is not checked, even though the rung holds a number for it', () => {
    const req = requirementFor(ladder, 'w0', { ...ALL, classes: false, skills: false, hours: false, daysAttended: false, minimumAge: false });
    const el = computeEligibility(req, { rankDate: '2026-01-01', today: '2026-07-01', classes: { total: 0, byType: {} }, signedSkillIds: [] });
    if (!el.hasNext) throw new Error();
    expect(el.daysOk).toBe(true);
    expect(el.eligible).toBe(true);
    expect(el.progressPercent).toBe(100);
    expect(el.missingSkillIds).toEqual([]);
  });

  it('the % is the average of the ticked requirements, each capped: 30/40, 90/180, 4/8 gives 58%', () => {
    const req = requirementFor(ladder, 'w0', DEFAULT_TICKS);
    const el = computeEligibility(req, { rankDate: '2026-01-01', today: '2026-04-01', classes: { total: 30, byType: {} }, signedSkillIds: signed(4) });
    if (!el.hasNext) throw new Error();
    expect(el.elapsedDays).toBe(90);
    expect(el.progressPercent).toBe(58);
    // Capped: 80 classes of 40 counts as 100%, not 200%.
    const over = computeEligibility(req, { rankDate: '2026-01-01', today: '2026-04-01', classes: { total: 80, byType: {} }, signedSkillIds: signed(4) });
    expect(over.hasNext && over.progressPercent).toBe(67);
  });

  it('hours and days attended count when ticked', () => {
    const req = requirementFor(ladder, 'w0', { ...ALL, minimumAge: false });
    const base = { rankDate: '2026-01-01', today: '2026-07-01', classes: { total: 40, byType: {} }, signedSkillIds: signed(8) };
    const short = computeEligibility(req, { ...base, minutesTrained: 25 * 60, daysAttended: 10 });
    if (!short.hasNext) throw new Error();
    expect([short.hoursOk, short.daysAttendedOk, short.eligible]).toEqual([false, false, false]);
    // (100 + 100 + 100 + 50 + 50) / 5
    expect(short.progressPercent).toBe(80);
    const met = computeEligibility(req, { ...base, minutesTrained: 50 * 60, daysAttended: 20 });
    expect(met.hasNext && [met.eligible, met.progressPercent]).toEqual([true, 100]);
  });

  it('100% only when every ticked requirement is met: one class short reads 99', () => {
    const req = requirementFor(ladder, 'w0', { ...DEFAULT_TICKS, daysInRank: false, skills: false });
    const el = computeEligibility(req, { rankDate: '2026-01-01', today: '2026-01-02', classes: { total: 399, byType: {} }, signedSkillIds: [] });
    const reqBig = requirementFor(
      flattenLadder([{ id: 'r', order: 0, stripeTiers: [tier({ id: 'a', order: 0 }), tier({ id: 'b', order: 1, classesRequired: 400 })] }]),
      'a',
      DEFAULT_TICKS,
    );
    const big = computeEligibility(reqBig, { rankDate: '2026-01-01', today: '2026-01-02', classes: { total: 399, byType: {} }, signedSkillIds: [] });
    expect(el.hasNext && el.eligible).toBe(true);
    expect(big.hasNext && [big.eligible, big.progressPercent]).toEqual([false, 99]);
  });

  it('minimum age is not in the %: a student at 100% who is too young waits for their birthday', () => {
    const req = requirementFor(ladder, 'w0', ALL);
    const base = { rankDate: '2026-01-01', today: '2026-07-01', classes: { total: 40, byType: {} }, signedSkillIds: signed(8), minutesTrained: 3000, daysAttended: 20 };
    const young = computeEligibility(req, { ...base, dateOfBirth: '2010-07-02' });
    if (!young.hasNext) throw new Error();
    expect([young.progressPercent, young.ageOk, young.eligible, young.waitingForAge]).toEqual([100, false, false, 16]);
    const birthday = computeEligibility(req, { ...base, dateOfBirth: '2010-07-01' });
    expect(birthday.hasNext && [birthday.ageOk, birthday.eligible, birthday.waitingForAge]).toEqual([true, true, null]);
    const unknown = computeEligibility(req, { ...base, dateOfBirth: null });
    expect(unknown.hasNext && [unknown.ageOk, unknown.eligible]).toEqual([false, false]);
  });

  it('"Waiting for age" only once everything else is met', () => {
    const req = requirementFor(ladder, 'w0', ALL);
    const el = computeEligibility(req, { rankDate: '2026-01-01', today: '2026-07-01', classes: { total: 10, byType: {} }, signedSkillIds: [], dateOfBirth: '2015-01-01' });
    expect(el.hasNext && el.waitingForAge).toBeNull();
  });

  it('a time-only rank still counts its days whatever the ticks, and the next rank\'s age', () => {
    const req = requirementFor(ladder, 'b0', { ...ALL, daysInRank: false });
    const el = computeEligibility(req, { rankDate: '2026-01-01', today: '2026-04-11', classes: { total: 0, byType: {} }, signedSkillIds: [], dateOfBirth: '2000-01-01' });
    if (!el.hasNext) throw new Error();
    expect([el.timeOnly, el.requiredDays, el.daysOk, el.minimumAge, el.ageOk, el.waitingForAge, el.eligible]).toEqual([true, 100, true, 30, false, 30, false]);
  });

  it('the breakdown lists only the ticked requirements', () => {
    const ticks = { ...ALL, classes: false };
    const req = requirementFor(ladder, 'w0', ticks);
    const el = computeEligibility(req, { rankDate: '2026-01-01', today: '2026-04-01', classes: { total: 0, byType: {} }, signedSkillIds: signed(2), minutesTrained: 600, daysAttended: 5, dateOfBirth: '2000-01-01' });
    expect(progressBreakdown(el, ticks)).toEqual({
      classes: null,
      days: { elapsed: 90, required: 180, percent: 50 },
      skills: { signedOff: 2, required: 8, percent: 25 },
      hours: { trainedMinutes: 600, requiredHours: 50, percent: 20 },
      daysAttended: { attended: 5, required: 20, percent: 25 },
      minimumAge: { age: 16, met: true },
    });
  });
});

describe('Decision 321 — board drag with the averaged %', () => {
  const req = requirementFor(ladder, 'w0', DEFAULT_TICKS);
  const base = { rankDate: '2026-04-01', today: '2026-04-01', classes: { total: 0, byType: {} }, signedSkillIds: [] as string[] };
  const landsIn = (move: ReturnType<typeof boardMoveAveraged>, column: string, input = base) => {
    if (move.kind !== 'ADJUST') return false;
    const day = (n: number) => new Date((Date.UTC(2026, 3, 1) / 86_400_000 - n) * 86_400_000).toISOString().slice(0, 10);
    const el = computeEligibility(req, {
      ...input,
      ...(move.classes ? { classes: { total: move.classes.total, byType: move.classes.byType ?? {} } } : {}),
      ...(move.daysInRank !== null ? { rankDate: day(move.daysInRank) } : {}),
    });
    return el.hasNext && boardColumn(el.progressPercent) === column;
  };

  it('moves the classes first, and the days too when the classes alone are not enough', () => {
    const getting = boardMoveAveraged(req, base, 'GETTING_THERE');
    expect(getting.kind === 'ADJUST' && getting.daysInRank).toBeNull();
    expect(landsIn(getting, 'GETTING_THERE')).toBe(true);
    // Classes alone reach at most (100 + 0 + 0) / 3 = 33%: the days move too.
    const ready = boardMoveAveraged(req, base, 'READY_TO_GRADE');
    expect(ready.kind === 'ADJUST' && ready.daysInRank !== null).toBe(true);
    expect(landsIn(ready, 'READY_TO_GRADE')).toBe(true);
  });

  it('refuses a column the classes and days can\'t reach', () => {
    const allSigned = { ...base, rankDate: '2025-01-01', signedSkillIds: signed(8) };
    // Skills alone are a third: never below 33% (Getting There).
    expect(boardMoveAveraged(req, allSigned, 'JUST_STARTING').kind).toBe('CANNOT_REACH');
  });
});

describe('ageOn', () => {
  it('counts whole years on a day', () => {
    expect(ageOn('2010-07-02', '2026-07-01')).toBe(15);
    expect(ageOn('2010-07-01', '2026-07-01')).toBe(16);
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
    expect(ageOn(null, '2026-07-01')).toBeNull();
    expect(ageOn('nonsense', '2026-07-01')).toBeNull();
  });
});
