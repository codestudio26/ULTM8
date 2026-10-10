import {
  AttendedClass,
  boardColumn,
  bookingAccess,
  computeEligibility,
  countClasses,
  CountRules,
  daysSince,
  dayNumber,
  flattenLadder,
  gradingDateProblem,
  LadderRank,
  localDay,
  requirementFor,
  Rung,
  weekStart,
} from './index';

const TODAY = '2026-10-09';

function daysAgo(n: number): string {
  const d = new Date(Date.UTC(2026, 9, 9) - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

type TierInput = Partial<LadderRank['stripeTiers'][number]> & { id: string; order: number };

function tier(t: TierInput): LadderRank['stripeTiers'][number] {
  return {
    name: t.id,
    timeOnly: false,
    classesRequired: 0,
    minimumDaysInRank: 0,
    eligibleClassTypes: [],
    classCountMode: 'ANY_TYPE',
    classTypeRequirements: [],
    weeklyClassCountCap: null,
    requiredSkillIds: [],
    ...t,
  };
}

/** An IBJJF-style adult ladder, after the prototype's `buildIbjjfLadder`:
 * White/Blue/Purple/Brown with 0–4 stripes as normal rungs, then Black Belt
 * degrees as time-only rungs. Every third rung gets two required skills, as
 * the QA harness does, so skills are exercised everywhere. */
function ibjjfLadder(): LadderRank[] {
  const belts: Array<[string, number, number]> = [
    ['white', 40, 180],
    ['blue', 40, 146],
    ['purple', 32, 110],
    ['brown', 26, 73],
  ];
  let n = 0;
  const skillsFor = () => (n++ % 3 === 1 ? ['skill-a', 'skill-b'] : []);
  const ranks: LadderRank[] = belts.map(([belt, classes, days], order) => ({
    id: belt,
    order,
    stripeTiers: [0, 1, 2, 3, 4].map((s) =>
      tier({
        id: `${belt}-${s}`,
        order: s,
        classesRequired: classes,
        minimumDaysInRank: days,
        eligibleClassTypes: ['Adult Fundamentals'],
        weeklyClassCountCap: 4,
        requiredSkillIds: skillsFor(),
      }),
    ),
  }));
  ranks.push({
    id: 'black',
    order: 4,
    stripeTiers: [0, 1, 2, 3, 4, 5, 6].map((d) =>
      tier({
        id: `black-${d}`,
        order: d,
        timeOnly: true,
        classesRequired: null,
        minimumDaysInRank: d < 3 ? 1095 : 1825,
        eligibleClassTypes: ['Adult Sparring', 'Competition Team'],
        weeklyClassCountCap: 0,
        requiredSkillIds: skillsFor(),
      }),
    ),
  });
  return ranks;
}

/* ====================================================================
   Reference rules, ported from the prototype's QA harness
   (deep-review/grading-prototype/qa/qa-harness.html, `refReq`,
   `refEligible`, `refPct`, `refBand`). Written independently of the
   engine, so the sweep below checks the engine against Gus's own rules.
   ==================================================================== */
interface RefStudent {
  since: string;
  classesAttended: unknown;
  skillStatus: Record<string, string> | undefined;
}
interface RefReq {
  next: Rung;
  timeOnly: boolean;
  classes: number;
  days: number;
  skills: string[];
  optionalSkills: string[];
}
function refReq(ladder: Rung[], rung: Rung): RefReq | null {
  const next = ladder[ladder.findIndex((r) => r.id === rung.id) + 1];
  if (!next) return null;
  if (rung.timeOnly) return { next, timeOnly: true, classes: 0, days: rung.minimumDaysInRank, skills: [], optionalSkills: next.requiredSkillIds.slice() };
  const src = next.timeOnly ? rung : next;
  return { next, timeOnly: false, classes: src.classesRequired, days: src.minimumDaysInRank, skills: src.requiredSkillIds.slice(), optionalSkills: [] };
}
const refDays = (since: string) => daysSince(since, TODAY);
function refEligible(req: RefReq, stu: RefStudent): boolean {
  const d = refDays(stu.since);
  if (req.timeOnly) return d >= req.days;
  const c = Number(stu.classesAttended) || 0;
  const st = stu.skillStatus || {};
  return c >= req.classes && d >= req.days && req.skills.every((id) => st[id] === 'signed');
}
function refPct(req: RefReq, stu: RefStudent): number {
  if (req.timeOnly) return req.days > 0 ? Math.min(100, Math.round((refDays(stu.since) / req.days) * 100)) : 100;
  return req.classes > 0 ? Math.min(100, Math.round(((Number(stu.classesAttended) || 0) / req.classes) * 100)) : 100;
}
const refBand = (p: number) => (p >= 66 ? 'READY_TO_GRADE' : p >= 33 ? 'GETTING_THERE' : 'JUST_STARTING');

/** The harness's `scenariosFor`, with its dates written as YYYY-MM-DD. */
function scenariosFor(req: RefReq): Array<RefStudent & { label: string }> {
  const sc: Array<RefStudent & { label: string }> = [];
  const add = (label: string, since: string, classesAttended: unknown, skillStatus: Record<string, string> | undefined) =>
    sc.push({ label, since, classesAttended, skillStatus });
  const allSigned = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'signed']));
  if (req.timeOnly) {
    const D = req.days;
    add('well past the required time', daysAgo(D + 3650), 0, {});
    add('exactly on the required day', daysAgo(D), 0, {});
    add('one day short', daysAgo(Math.max(0, D - 1)), 0, {});
    add('one day over', daysAgo(D + 1), 0, {});
    add('promoted today', TODAY, 0, {});
    add('unreadable date', 'Unknown', 0, {});
    add('empty date', '', 0, {});
    add('date in the future', daysAgo(-365), 0, {});
    add('huge class count (must not matter)', daysAgo(Math.max(0, D - 30)), 9999, {});
    add('optional skills all signed but time short (must not rescue)', daysAgo(Math.max(0, D - 30)), 0, allSigned(req.optionalSkills));
    add('optional skills unsigned but time met (must not block)', daysAgo(D + 5), 0, {});
    return sc;
  }
  const C = req.classes;
  const D = req.days;
  const all = allSigned(req.skills);
  const learning = Object.fromEntries(req.skills.map((id) => [id, 'learning']));
  add('comfortably ready', daysAgo(D + 400), C + 15, all);
  add('exactly on the class requirement', daysAgo(D + 400), C, all);
  add('one class short', daysAgo(D + 400), Math.max(0, C - 1), all);
  add('exactly on the minimum days', daysAgo(D), C + 3, all);
  add('one day short of the minimum days', daysAgo(Math.max(0, D - 1)), C + 3, all);
  add('one day past the minimum days', daysAgo(D + 1), C + 3, all);
  add('brand new today', TODAY, 0, {});
  add('plenty of classes but promoted today', TODAY, C + 50, all);
  add('long in rank but no classes', daysAgo(D + 900), 0, all);
  add('half way on classes', daysAgo(D + 400), Math.round(C * 0.5), all);
  add('unreadable date, classes met', 'N/A', C + 2, all);
  add('date in the future, classes met', daysAgo(-400), C + 2, all);
  add('class count missing from the record', daysAgo(D + 400), undefined, all);
  add('class count stored as text', daysAgo(D + 400), String(C), all);
  add('skill record missing altogether', daysAgo(D + 400), C + 2, undefined);
  if (req.skills.length) {
    add('skills only at "learning"', daysAgo(D + 400), C + 5, learning);
    add('no skills signed', daysAgo(D + 400), C + 5, {});
    const oneShort = { ...all };
    delete oneShort[req.skills[req.skills.length - 1]];
    add('one skill short', daysAgo(D + 400), C + 5, oneShort);
  }
  return sc;
}

/** The harness's student record in the engine's input shape. */
function engineInput(stu: RefStudent) {
  const classes = Number(stu.classesAttended) || 0;
  return {
    rankDate: stu.since,
    today: TODAY,
    classes: { total: classes, byType: {} },
    signedSkillIds: Object.entries(stu.skillStatus ?? {})
      .filter(([, v]) => v === 'signed')
      .map(([k]) => k),
  };
}

describe('grading engine — sweep against the prototype reference rules', () => {
  const ladder = flattenLadder(ibjjfLadder());

  it('flattens belts and tiers into one ordered ladder', () => {
    expect(ladder.map((r) => r.id).slice(0, 7)).toEqual(['white-0', 'white-1', 'white-2', 'white-3', 'white-4', 'blue-0', 'blue-1']);
    expect(ladder).toHaveLength(27);
    expect(ladder[ladder.length - 1].id).toBe('black-6');
  });

  for (const rung of flattenLadder(ibjjfLadder())) {
    const req = refReq(ladder, rung);
    if (!req) {
      it(`${rung.id}: the top rung has no next grade`, () => {
        const r = requirementFor(ladder, rung.id);
        expect(r.kind).toBe('TOP');
        expect(computeEligibility(r, engineInput({ since: daysAgo(5000), classesAttended: 999, skillStatus: {} }))).toEqual({
          hasNext: false,
          dataError: false,
        });
      });
      continue;
    }
    for (const sc of scenariosFor(req)) {
      it(`${rung.id} — ${sc.label}`, () => {
        const r = requirementFor(ladder, rung.id);
        const el = computeEligibility(r, engineInput(sc));
        if (!el.hasNext) throw new Error('expected a next rung');
        expect(el.nextRungId).toBe(req.next.id);
        expect(el.eligible).toBe(refEligible(req, sc));
        expect(el.progressPercent).toBe(refPct(req, sc));
        expect(boardColumn(el.progressPercent)).toBe(refBand(refPct(req, sc)));
        expect(el.timeOnly).toBe(req.timeOnly);
        expect(el.requiredSkillIds).toEqual(req.skills);
        expect(el.optionalSkillIds).toEqual(req.optionalSkills);
        // The harness's "skills not signed" warning: never on a time-only rung.
        const refMissing = !req.timeOnly && req.skills.some((id) => (sc.skillStatus || {})[id] !== 'signed');
        expect(el.missingSkillIds.length > 0).toBe(refMissing);
      });
    }
  }
});

describe('grading engine — requirement source (Decision 127)', () => {
  const ladder = flattenLadder(ibjjfLadder());

  it('normal → normal reads the next rung, including its count rules', () => {
    const r = requirementFor(ladder, 'white-4');
    if (r.kind !== 'NEXT') throw new Error();
    expect(r.next.id).toBe('blue-0');
    expect([r.requiredClasses, r.requiredDays]).toEqual([40, 146]);
  });

  it('normal → time-only reads the current rung, including which classes count and its cap', () => {
    const r = requirementFor(ladder, 'brown-4');
    if (r.kind !== 'NEXT') throw new Error();
    expect(r.next.id).toBe('black-0');
    expect([r.requiredClasses, r.requiredDays]).toEqual([26, 73]);
    expect(r.countRules.eligibleClassTypes).toEqual(['Adult Fundamentals']);
    expect(r.countRules.weeklyClassCountCap).toBe(4);
  });

  it('time-only → anything: the current rung\'s days, no classes, next rung\'s skills optional', () => {
    const r = requirementFor(ladder, 'black-0');
    if (r.kind !== 'NEXT') throw new Error();
    expect(r.timeOnly).toBe(true);
    expect([r.requiredClasses, r.requiredDays]).toEqual([0, 1095]);
    expect(r.requiredSkillIds).toEqual([]);
    expect(r.optionalSkillIds).toEqual(ladder.find((x) => x.id === 'black-1')!.requiredSkillIds);
  });

  it('a rung that is not on the ladder is a data error, not the top', () => {
    expect(requirementFor(ladder, 'missing')).toEqual({ kind: 'DATA_ERROR' });
    expect(computeEligibility({ kind: 'DATA_ERROR' }, engineInput({ since: TODAY, classesAttended: 0, skillStatus: {} }))).toEqual({
      hasNext: false,
      dataError: true,
    });
  });

  it('missing class/day numbers read as 0', () => {
    const l = flattenLadder([{ id: 'r', order: 0, stripeTiers: [tier({ id: 'a', order: 0 }), tier({ id: 'b', order: 1, classesRequired: null, minimumDaysInRank: null })] }]);
    const r = requirementFor(l, 'a');
    if (r.kind !== 'NEXT') throw new Error();
    expect([r.requiredClasses, r.requiredDays]).toEqual([0, 0]);
    const el = computeEligibility(r, engineInput({ since: TODAY, classesAttended: 0, skillStatus: {} }));
    expect(el.hasNext && [el.eligible, el.progressPercent]).toEqual([true, 100]);
  });
});

describe('grading engine — counting classes (Decisions 140, 171)', () => {
  const rules = (over: Partial<CountRules> = {}): CountRules => ({
    eligibleClassTypes: ['Fundamentals'],
    classCountMode: 'ANY_TYPE',
    classTypeRequirements: [],
    weeklyClassCountCap: null,
    ...over,
  });
  const c = (day: string, classType: string | null, at?: string): AttendedClass => ({ day, classType, at });

  it('counts only ticked types', () => {
    const t = countClasses([c('2026-10-05', 'Fundamentals'), c('2026-10-06', 'Sparring'), c('2026-10-07', null)], rules());
    expect(t).toEqual({ total: 1, byType: { Fundamentals: 1 } });
  });

  it('nothing ticked: every class counts, including one with no type', () => {
    const t = countClasses([c('2026-10-05', 'Fundamentals'), c('2026-10-06', 'Sparring'), c('2026-10-07', null)], rules({ eligibleClassTypes: [] }));
    expect(t.total).toBe(3);
  });

  it('weekly cap: Monday–Sunday weeks, extras ignored, not carried over', () => {
    // 2026-10-05 is a Monday, 2026-10-11 a Sunday, 2026-10-12 the next Monday.
    const week1 = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-11'].map((d) => c(d, 'Fundamentals'));
    const week2 = [c('2026-10-12', 'Fundamentals')];
    expect(countClasses([...week1, ...week2], rules({ weeklyClassCountCap: 3 })).total).toBe(4);
  });

  it('the cap keeps the earliest classes of the week, whatever order they arrive in', () => {
    const t = countClasses(
      [c('2026-10-09', 'Sparring'), c('2026-10-05', 'Fundamentals'), c('2026-10-06', 'Fundamentals')],
      rules({ eligibleClassTypes: ['Fundamentals', 'Sparring'], weeklyClassCountCap: 2 }),
    );
    expect(t.byType).toEqual({ Fundamentals: 2 });
  });

  it('same day: the start time decides which class is the extra', () => {
    const t = countClasses(
      [c('2026-10-05', 'Sparring', '2026-10-05T18:00'), c('2026-10-05', 'Fundamentals', '2026-10-05T09:00')],
      rules({ eligibleClassTypes: ['Fundamentals', 'Sparring'], weeklyClassCountCap: 1 }),
    );
    expect(t.byType).toEqual({ Fundamentals: 1 });
  });

  it('an unticked class does not use up the week\'s allowance', () => {
    const t = countClasses([c('2026-10-05', 'Sparring'), c('2026-10-06', 'Fundamentals')], rules({ weeklyClassCountCap: 1 }));
    expect(t.total).toBe(1);
    expect(t.byType).toEqual({ Fundamentals: 1 });
  });

  it.each([null, 0])('cap %p means no limit', (cap) => {
    const many = Array.from({ length: 7 }, (_, i) => c(`2026-10-0${5 + (i % 5)}`, 'Fundamentals'));
    expect(countClasses(many, rules({ weeklyClassCountCap: cap })).total).toBe(7);
  });

  it('a class with an unreadable day is not counted', () => {
    expect(countClasses([c('not a day', 'Fundamentals'), c('2026-02-30', 'Fundamentals')], rules()).total).toBe(0);
  });
});

describe('grading engine — "each ticked type required" (Decisions 149, 171)', () => {
  const ladder = flattenLadder([
    {
      id: 'r',
      order: 0,
      stripeTiers: [
        tier({ id: 'a', order: 0 }),
        tier({
          id: 'b',
          order: 1,
          eligibleClassTypes: ['Fundamentals', 'Sparring'],
          classCountMode: 'EACH_TYPE',
          classTypeRequirements: [
            { classType: 'Fundamentals', classesRequired: 20 },
            { classType: 'Sparring', classesRequired: 10 },
          ],
          minimumDaysInRank: 30,
        }),
      ],
    },
  ]);
  const req = requirementFor(ladder, 'a');
  const run = (fundamentals: number, sparring: number) =>
    computeEligibility(req, {
      rankDate: daysAgo(100),
      today: TODAY,
      classes: { total: fundamentals + sparring, byType: { Fundamentals: fundamentals, Sparring: sparring } },
      signedSkillIds: [],
    });

  it('progress is combined, each type capped at its own number: 18/20 + 4/10 = 22/30 = 73%', () => {
    const el = run(18, 4);
    if (!el.hasNext) throw new Error();
    expect(el.requiredClasses).toBe(30);
    expect(el.progressPercent).toBe(73);
    expect(el.classesOk).toBe(false);
  });

  it('extra classes of one type never make up for another: 40 + 0 is 20/30', () => {
    const el = run(40, 0);
    if (!el.hasNext) throw new Error();
    expect(el.progressPercent).toBe(67);
    expect(el.classesOk).toBe(false);
    expect(el.byType).toEqual([
      { classType: 'Fundamentals', required: 20, counted: 40 },
      { classType: 'Sparring', required: 10, counted: 0 },
    ]);
  });

  it('eligible only when every type\'s number is met', () => {
    const el = run(20, 10);
    expect(el.hasNext && [el.classesOk, el.eligible, el.progressPercent]).toEqual([true, true, 100]);
  });
});

describe('grading engine — board columns (Decision 136)', () => {
  it.each([
    [0, 'JUST_STARTING'],
    [32, 'JUST_STARTING'],
    [33, 'GETTING_THERE'],
    [65, 'GETTING_THERE'],
    [66, 'READY_TO_GRADE'],
    [100, 'READY_TO_GRADE'],
  ])('%p%% → %s by default', (pct, col) => {
    expect(boardColumn(pct)).toBe(col);
  });

  it('uses a school\'s own thresholds', () => {
    expect(boardColumn(50, { gettingThere: 20, readyToGrade: 50 })).toBe('READY_TO_GRADE');
  });
});

describe('grading engine — grading date (Decision 128, item 8)', () => {
  it('refuses a future date', () => expect(gradingDateProblem('2026-10-10', TODAY, '2026-01-01')).toBe('IN_FUTURE'));
  it('refuses a date before the current rank', () => expect(gradingDateProblem('2025-12-31', TODAY, '2026-01-01')).toBe('BEFORE_CURRENT_RANK'));
  it('allows today and the current rank\'s own day', () => {
    expect(gradingDateProblem(TODAY, TODAY, '2026-01-01')).toBeNull();
    expect(gradingDateProblem('2026-01-01', TODAY, '2026-01-01')).toBeNull();
  });
  it('allows any past date when there is no current rank', () => expect(gradingDateProblem('2000-01-01', TODAY, null)).toBeNull());
  it('refuses an unreadable date', () => expect(gradingDateProblem('2026-02-30', TODAY, null)).toBe('INVALID'));
});

describe('grading engine — days', () => {
  it('daysSince: unreadable, empty or future dates read as 0', () => {
    expect(daysSince('Unknown', TODAY)).toBe(0);
    expect(daysSince(null, TODAY)).toBe(0);
    expect(daysSince('2027-01-01', TODAY)).toBe(0);
    expect(daysSince('2026-10-01', TODAY)).toBe(8);
  });

  it('weekStart is the Monday of the week', () => {
    for (const d of ['2026-10-05', '2026-10-08', '2026-10-11']) expect(weekStart(dayNumber(d)!)).toBe(dayNumber('2026-10-05'));
    expect(weekStart(dayNumber('2026-10-12')!)).toBe(dayNumber('2026-10-12'));
    expect(weekStart(dayNumber('1970-01-01')!)).toBe(dayNumber('1969-12-29'));
  });

  it('localDay uses the given zone', () => {
    const instant = new Date('2026-10-09T23:30:00Z');
    expect(localDay(instant, 'UTC')).toBe('2026-10-09');
    expect(localDay(instant, 'Australia/Sydney')).toBe('2026-10-10');
    expect(localDay(instant, 'America/Los_Angeles')).toBe('2026-10-09');
    expect(() => localDay(instant, 'Not/AZone')).toThrow('Invalid time zone');
  });
});

describe('grading engine — booking access (Decision 173)', () => {
  // Gus's example: White · 3 Stripes unlocks Advanced and Open Mat, Purple Belt
  // unlocks Competition; Fundamentals is unlocked nowhere, so it is open.
  const ladder = flattenLadder([
    { id: 'white', order: 0, stripeTiers: [0, 1, 2, 3, 4].map((n) => tier({ id: `white-${n}`, order: n, bookingUnlocksClassTypes: n === 3 ? ['Advanced', 'Open Mat'] : [] })) },
    { id: 'blue', order: 1, stripeTiers: [0, 1, 2].map((n) => tier({ id: `blue-${n}`, order: n })) },
    { id: 'purple', order: 2, stripeTiers: [tier({ id: 'purple-0', order: 0, bookingUnlocksClassTypes: ['Competition'] })] },
  ]);
  const row = (rung: string) => ['Fundamentals', 'Advanced', 'Open Mat', 'Competition'].map((t) => bookingAccess(ladder, rung, t));

  it.each([
    ['white-1', ['OPEN', 'LOCKED', 'LOCKED', 'LOCKED']],
    ['white-3', ['OPEN', 'UNLOCKED', 'UNLOCKED', 'LOCKED']],
    ['blue-2', ['OPEN', 'UNLOCKED', 'UNLOCKED', 'LOCKED']],
    ['purple-0', ['OPEN', 'UNLOCKED', 'UNLOCKED', 'UNLOCKED']],
  ])('%s', (rung, expected) => {
    expect(row(rung)).toEqual(expected);
  });

  it('a class with no type is open', () => expect(bookingAccess(ladder, 'white-0', null)).toBe('OPEN'));
  it('no rung in the style: open types stay open, restricted ones are locked', () => {
    expect(bookingAccess(ladder, null, 'Fundamentals')).toBe('OPEN');
    expect(bookingAccess(ladder, null, 'Open Mat')).toBe('LOCKED');
  });
  it('a style where nothing is set is open throughout', () => {
    const plain = flattenLadder([{ id: 'r', order: 0, stripeTiers: [tier({ id: 'a', order: 0 })] }]);
    expect(bookingAccess(plain, 'a', 'Anything')).toBe('OPEN');
  });
});
