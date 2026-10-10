/**
 * Grading acceptance (roadmap Phase 7, item 1): Gus's prototype scenarios
 * (deep-review/grading-prototype/qa/qa-harness.html) re-run against the real
 * API over HTTP. Expected answers come from the harness's own reference rules
 * (refReq / refEligible / refPct / refBand), ported below and computed from the
 * ladder as stored in the database, never from the API's grading engine.
 *
 * The full run (every scenario on every stripe of the three IBJJF templates,
 * 600 drags, 3 x 600 random actions; about 15 minutes) is recorded in
 * docs/grading-integration/hardening/ACCEPTANCE-REPORT.md. CI runs a sample:
 * every 3rd stripe with 2 scenarios each, 30 board drags, 150 random actions.
 * Full size: ACCEPTANCE_FULL=1 (or set the knobs below one by one).
 *
 * "Today" is the server clock in UTC (the test School has no time zone).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { PrismaClient, SkillSignOffStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const hasDb = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;
if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-acceptance.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const FULL = process.env.ACCEPTANCE_FULL === '1';
const knob = (name: string, ci: number, full: number) => Number(process.env[name] ?? (FULL ? full : ci));
/** Sweep every Nth stripe of each template (1 = all). */
const SWEEP_RUNG_EVERY = knob('SWEEP_RUNG_EVERY', 3, 1);
/** Scenarios per stripe in the sweep (0 = all of the harness's scenarios). */
const SWEEP_SCENARIOS = knob('SWEEP_SCENARIOS', 2, 0);
const DRAG_SAMPLE = knob('DRAG_SAMPLE', 30, 100);
const RANDOM_STEPS = knob('RANDOM_STEPS', 150, 600);
const RANDOM_RUNS = knob('RANDOM_RUNS', 1, 3);
const SEED = Number(process.env.SEED || 20261010);

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Result bookkeeping
// ---------------------------------------------------------------------------
type Fail = { suite: string; family: string; label: string; detail: string };
const T = { tested: 0, pass: 0, fail: 0 };
const perSuite: Record<string, { tested: number; fail: number; ms: number }> = {};
const fails: Fail[] = [];
const notes: Array<{ suite: string; text: string }> = [];
let curSuite = '';
let curFamily = '';
function ok(cond: boolean, label: string, detail: unknown = '', fam?: string): boolean {
  T.tested++;
  perSuite[curSuite].tested++;
  if (cond) T.pass++;
  else {
    T.fail++;
    perSuite[curSuite].fail++;
    fails.push({ suite: curSuite, family: fam ?? curFamily, label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
  return cond;
}
const eq = (a: unknown, b: unknown, label: string, fam?: string) => ok(JSON.stringify(a) === JSON.stringify(b), label, `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`, fam);
const note = (text: string) => notes.push({ suite: curSuite, text });
async function suite(name: string, fn: () => Promise<void>) {
  curSuite = name;
  perSuite[name] = { tested: 0, fail: 0, ms: 0 };
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    ok(false, 'suite stopped early', String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | '));
  }
  perSuite[name].ms = Date.now() - t0;
}
const family = (f: string) => (curFamily = f);

// ---------------------------------------------------------------------------
// Days (UTC; the School has no time zone)
// ---------------------------------------------------------------------------
const RUN_START = new Date();
const TODAY_NUM = Math.floor(Date.UTC(RUN_START.getUTCFullYear(), RUN_START.getUTCMonth(), RUN_START.getUTCDate()) / DAY);
const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const TODAY = dayStr(TODAY_NUM);
/** An instant on the day `n` days ago (noon UTC, so the local day is unambiguous). */
const instantDaysAgo = (n: number) => new Date((TODAY_NUM - n) * DAY + 12 * 3_600_000);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dayNumOf = (d: Date) => Math.floor(d.getTime() / DAY);

// ---------------------------------------------------------------------------
// The harness's reference rules ("the oracle"), ported unchanged in meaning
// ---------------------------------------------------------------------------
interface RefRung { id: string; rankId: string; name: string; timeOnly: boolean; classCount: number; minDays: number; skills: string[]; idx: number }
interface RefStu { sinceDay: number; classesAttended: number; skillStatus: Record<string, string> }
interface RefReq { next: RefRung; timeOnly: boolean; classes: number; days: number; skills: string[]; optionalSkills: string[] }
function refDays(sinceDay: number) {
  return Math.max(0, TODAY_NUM - sinceDay);
}
function refReq(ladder: RefRung[], rung: RefRung): RefReq | null {
  const next = ladder[rung.idx + 1];
  if (!next) return null;
  if (rung.timeOnly) return { next, timeOnly: true, classes: 0, days: rung.minDays, skills: [], optionalSkills: next.skills.slice() };
  const src = next.timeOnly ? rung : next;
  return { next, timeOnly: false, classes: src.classCount, days: src.minDays, skills: src.skills.slice(), optionalSkills: [] };
}
function refEligible(req: RefReq, stu: RefStu) {
  const d = refDays(stu.sinceDay);
  if (req.timeOnly) return d >= req.days;
  const c = Number(stu.classesAttended) || 0;
  return c >= req.classes && d >= req.days && req.skills.every((id) => stu.skillStatus[id] === 'signed');
}
function refPct(req: RefReq, stu: RefStu) {
  if (req.timeOnly) return req.days > 0 ? Math.min(100, Math.round((refDays(stu.sinceDay) / req.days) * 100)) : 100;
  return req.classes > 0 ? Math.min(100, Math.round(((Number(stu.classesAttended) || 0) / req.classes) * 100)) : 100;
}
const refBand = (p: number) => (p >= 66 ? 'READY_TO_GRADE' : p >= 33 ? 'GETTING_THERE' : 'JUST_STARTING');
const refSkillsMissing = (req: RefReq, stu: RefStu) => !req.timeOnly && req.skills.some((id) => stu.skillStatus[id] !== 'signed');
const allSigned = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'signed']));
const STATUS: Record<string, SkillSignOffStatus> = { signed: 'SIGNED_OFF', learning: 'LEARNING', not_started: 'NOT_STARTED' };
const FROM_STATUS: Record<string, string> = { SIGNED_OFF: 'signed', LEARNING: 'learning', NOT_STARTED: 'not_started' };

/** The harness's mulberry32 rng. */
function rng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k], k);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// App + seed helpers
// ---------------------------------------------------------------------------
const su = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const jwtSvc = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
let app: INestApplication;
let BASE = '';
let school: { id: string };
let ownerTok = '';
const userIds: string[] = [];
let phoneN = 0;

type Res = { status: number; body: any };
async function api(method: string, url: string, body?: unknown, tok = ownerTok): Promise<Res> {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
const msg = (r: Res) => `${r.status} ${typeof r.body === 'object' ? JSON.stringify(r.body?.message ?? r.body?.error ?? r.body).slice(0, 220) : String(r.body).slice(0, 220)}`;

function userRow(first: string, surname: string) {
  phoneN++;
  const id = randomUUID();
  userIds.push(id);
  return {
    id,
    email: `gaccept-${id}@example.test`,
    phone: `+1888${String(process.pid % 1000).padStart(3, '0')}${String(phoneN).padStart(7, '0')}`,
    firstName: first,
    surname,
    passcodeHash: 'x',
    dateOfBirth: new Date('2000-01-01'),
    phoneVerifiedAt: new Date(),
  };
}
async function mkStudents(n: number, names?: (i: number) => [string, string]): Promise<string[]> {
  const rows = Array.from({ length: n }, (_, i) => {
    const [f, s] = names ? names(i) : ['QA', `Student ${phoneN + 1}`];
    return userRow(f, s);
  });
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await su.user.createMany({ data: chunk });
    await su.roleGrant.createMany({ data: chunk.map((u) => ({ id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id })) });
  }
  return rows.map((r) => r.id);
}

/** The ladder exactly as stored, flattened the way the harness sorts ranks:
 * belts by order, then each belt's rungs by order. */
async function refLadder(disciplineId: string): Promise<RefRung[]> {
  const belts = await su.rank.findMany({
    where: { disciplineId },
    orderBy: { order: 'asc' },
    include: { stripeTiers: { orderBy: { order: 'asc' }, include: { requiredSkills: true } } },
  });
  const out: RefRung[] = [];
  for (const b of belts) {
    for (const t of b.stripeTiers) {
      out.push({
        id: t.id,
        rankId: b.id,
        name: t.name,
        timeOnly: t.timeOnly,
        classCount: t.classesRequired ?? 0,
        minDays: t.minimumDaysInRank ?? 0,
        skills: t.requiredSkills.map((s: { skillId: string }) => s.skillId).sort(),
        idx: out.length,
      });
    }
  }
  return out;
}

async function fromTemplate(templateId: string, name: string) {
  const r = await api('POST', `/v1/schools/${school.id}/disciplines/from-template`, { templateId, name });
  if (r.status !== 201) throw new Error(`from-template ${templateId}: ${msg(r)}`);
  return r.body as { id: string; classTypesOffered: string[] };
}
async function mkSkill(disciplineId: string, name: string): Promise<string> {
  const r = await api('POST', `/v1/styles/${disciplineId}/skills`, { name });
  if (r.status !== 201) throw new Error(`skill ${name}: ${msg(r)}`);
  return r.body.id;
}
async function attachSkills(rungId: string, skillIds: string[]) {
  await su.rankStripeTierRequiredSkill.deleteMany({ where: { stripeTierId: rungId } });
  if (skillIds.length) await su.rankStripeTierRequiredSkill.createMany({ data: skillIds.map((skillId) => ({ stripeTierId: rungId, skillId })) });
}

interface Seed { studentId: string; disciplineId: string; rung: RefRung; sinceDay: number; classes: number; skills: Record<string, string>; active?: boolean | null }
async function seedRanks(seeds: Seed[]) {
  const ranks = seeds.map((s) => ({
    id: randomUUID(),
    studentId: s.studentId,
    disciplineId: s.disciplineId,
    schoolId: school.id,
    currentRankId: s.rung.rankId,
    currentStripeId: s.rung.id,
    dateOfCurrentRank: new Date(s.sinceDay * DAY + 12 * 3_600_000),
    classesAttendedTowardCheckpoint: s.classes,
    boardActiveOverride: s.active === undefined ? null : s.active,
  }));
  await su.studentRank.createMany({ data: ranks });
  const statuses = seeds.flatMap((s, i) =>
    Object.entries(s.skills).map(([skillId, st]) => ({
      id: randomUUID(),
      studentRankId: ranks[i].id,
      schoolId: school.id,
      studentId: s.studentId,
      skillId,
      status: STATUS[st],
    })),
  );
  if (statuses.length) await su.studentRankSkillStatus.createMany({ data: statuses });
  return ranks.map((r) => r.id);
}
const srOf = (studentId: string, disciplineId: string) =>
  su.studentRank.findUnique({ where: { studentId_disciplineId: { studentId, disciplineId } }, include: { skillStatuses: true } });
const eventsOf = (studentRankId: string) => su.promotionEvent.findMany({ where: { studentRankId }, orderBy: { createdAt: 'desc' } });
async function eligibilityOf(studentId: string, disciplineId: string): Promise<{ res: Res; el: any }> {
  const res = await api('GET', `/v1/students/${studentId}/eligibility?schoolId=${school.id}`);
  const item = res.status === 200 ? res.body.items.find((i: any) => i.disciplineId === disciplineId) : null;
  return { res, el: item?.eligibility };
}
const promote = (studentId: string, disciplineId: string, body: object) => api('POST', `/v1/students/${studentId}/ranks/${disciplineId}/promote`, body);
const downgrade = (studentId: string, disciplineId: string, body: object) => api('POST', `/v1/students/${studentId}/ranks/${disciplineId}/downgrade`, body);
const NUMERIC_FIELDS = ['elapsedDays', 'requiredDays', 'requiredClasses', 'countedClasses', 'progressPercent'];

// ===========================================================================
// SUITE 2 — the template ladders, through the API
// ===========================================================================
const EXPECTED_RUNGS: Record<string, number> = { ibjjf: 90, ibjjf_kids_red: 139, ibjjf_kids_yellow: 175 };
const sweepStyles: Array<{ tid: string; id: string; classTypes: string[] }> = [];

async function suiteLadders() {
  family('2a template list');
  const list = await api('GET', '/v1/style-templates');
  ok(list.status === 200, 'GET /style-templates answers', msg(list));
  const ids = (list.body?.items ?? []).map((t: any) => t.id);
  eq(ids, ['ibjjf', 'ibjjf_kids_red', 'ibjjf_kids_yellow'], 'the API offers the three IBJJF templates (Decision 131: Karate/TKD/Judo/Muay Thai/Kids BJJ/MMA not shipped)');
  for (const tid of Object.keys(EXPECTED_RUNGS)) {
    family('2b ladder from template');
    const meta = (list.body?.items ?? []).find((t: any) => t.id === tid);
    const st = await fromTemplate(tid, `Sweep ${tid}`);
    sweepStyles.push({ tid, id: st.id, classTypes: st.classTypesOffered });
    const ranksRes = await api('GET', `/v1/styles/${st.id}/ranks`);
    ok(ranksRes.status === 200, `${tid}: GET /styles/{id}/ranks answers`, msg(ranksRes));
    const belts = (ranksRes.body?.items ?? []).slice().sort((a: any, b: any) => a.order - b.order);
    const rs: any[] = belts.flatMap((b: any) => (b.stripeTiers ?? []).slice().sort((x: any, y: any) => x.order - y.order).map((t: any) => ({ ...t, beltName: b.name })));
    eq(rs.length, EXPECTED_RUNGS[tid], `${tid}: number of rungs created`);
    eq(meta?.rungs, rs.length, `${tid}: the count on the template card matches what is created`);
    eq(new Set(rs.map((r) => r.id)).size, rs.length, `${tid}: rung ids are unique`);
    eq(new Set(rs.map((r) => r.name)).size, rs.length, `${tid}: rung names are unique`);
    ok(belts.every((b: any, i: number) => b.order === i) && belts.every((b: any) => b.stripeTiers.every((t: any, i: number) => t.order === i || true)), `${tid}: belt order runs 0..N-1 with no gaps`);
    ok(
      belts.every((b: any) => b.stripeTiers.map((t: any) => t.order).sort((x: number, y: number) => x - y).every((o: number, i: number) => o === i)),
      `${tid}: rung order inside each belt runs 0..N-1 with no gaps`,
    );
    ok(
      rs.every((r) => (r.timeOnly ? r.classesRequired === null || r.classesRequired >= 0 : Number.isInteger(r.classesRequired) && r.classesRequired >= 0) && Number.isInteger(r.minimumDaysInRank) && r.minimumDaysInRank >= 0),
      `${tid}: every rung has valid numbers`,
      rs.filter((r) => !(Number.isInteger(r.minimumDaysInRank) && r.minimumDaysInRank >= 0)).slice(0, 3).map((r) => r.name),
    );
    ok(rs.every((r) => r.eligibleClassTypes.length > 0 && r.eligibleClassTypes.every((c: string) => st.classTypesOffered.includes(c))), `${tid}: every rung counts class types that exist in the style`);
    const timeOnly = rs.filter((r) => r.timeOnly);
    eq(timeOnly.length, 10, `${tid}: Black Belt (7 rungs) and the 3 coral belts are time-only`);
    ok(rs.slice(-10).every((r) => r.timeOnly), `${tid}: the time-only rungs are the last 10`);
    eq(timeOnly.map((r) => Math.round(r.minimumDaysInRank / 365)).join(','), '3,3,3,5,5,5,7,7,10,0', `${tid}: years per degree are 3-3-3-5-5-5-7-7-10`);
    eq(rs[rs.length - 1]?.name, 'Red Belt (9th Degree)', `${tid}: Red Belt is the top rung`);
    const white = rs.filter((r) => /^White Belt/.test(r.name)).map((r) => r.name);
    eq(white.slice(0, 5).join('|'), 'White Belt|White Belt · 1 Stripe|White Belt · 2 Stripes|White Belt · 3 Stripes|White Belt · 4 Stripes', `${tid}: White Belt has rungs 0-4 stripes`);
    const grey = rs.filter((r) => r.beltName === 'Grey Belt');
    const greyNames = grey.map((r) => r.name.replace('Grey Belt', '').replace(' · ', '')).join('|');
    const expectGrey =
      tid === 'ibjjf'
        ? '|1 Stripe|2 Stripes|3 Stripes|4 Stripes'
        : tid === 'ibjjf_kids_red'
          ? '|1 Stripe|2 Stripes|3 Stripes|4 Stripes|1 Red Stripe|2 Red Stripes|3 Red Stripes|4 Red Stripes'
          : '|1 Stripe|2 Stripes|3 Stripes|4 Stripes|1 Red Stripe|2 Red Stripes|3 Red Stripes|4 Red Stripes|1 Yellow Stripe|2 Yellow Stripes|3 Yellow Stripes';
    eq(greyNames, expectGrey, `${tid}: Grey Belt rung sequence`);
    ok(grey.every((r) => (r.stripeSegments ?? []).reduce((a: number, s: any) => a + s.count, 0) <= 4), `${tid}: a kids belt never shows more than 4 stripes`);
    ok(grey.every((r) => r.classesRequired === 18 && r.minimumDaysInRank === 73), `${tid}: every Grey Belt rung carries 18 classes / 73 days`);
    if (tid !== 'ibjjf') eq(white.length, 6, `${tid}: White Belt takes exactly one red stripe`);
  }
}

// ===========================================================================
// SUITE 3 — eligibility and grading on every rung of every template
// ===========================================================================
interface Scenario { label: string; sinceDay: number; classes: number; skills: Record<string, string>; na?: string }
function scenariosFor(req: RefReq): Scenario[] {
  const sc: Scenario[] = [];
  const ago = (n: number) => TODAY_NUM - n;
  const add = (label: string, sinceDay: number, classes: number, skills: Record<string, string>, na?: string) => sc.push({ label, sinceDay, classes, skills, na });
  if (req.timeOnly) {
    const D = req.days;
    add('well past the required time', ago(D + 3650), 0, {});
    add('exactly on the required day', ago(D), 0, {});
    add('one day short', ago(Math.max(0, D - 1)), 0, {});
    add('one day over', ago(D + 1), 0, {});
    add('promoted today', ago(0), 0, {});
    add('unreadable date', 0, 0, {}, 'dateOfCurrentRank is a non-null timestamp column');
    add('empty date', 0, 0, {}, 'dateOfCurrentRank is a non-null timestamp column');
    add('date in the future', ago(-365), 0, {});
    add('huge class count (must not matter)', ago(Math.max(0, D - 30)), 9999, {});
    add('optional skills all signed but time short (must not rescue)', ago(Math.max(0, D - 30)), 0, allSigned(req.optionalSkills));
    add('optional skills unsigned but time met (must not block)', ago(D + 5), 0, {});
    return sc;
  }
  const C = req.classes;
  const D = req.days;
  const all = allSigned(req.skills);
  const learning = Object.fromEntries(req.skills.map((id) => [id, 'learning']));
  add('comfortably ready', ago(D + 400), C + 15, all);
  add('exactly on the class requirement', ago(D + 400), C, all);
  add('one class short', ago(D + 400), Math.max(0, C - 1), all);
  add('exactly on the minimum days', ago(D), C + 3, all);
  add('one day short of the minimum days', ago(Math.max(0, D - 1)), C + 3, all);
  add('one day past the minimum days', ago(D + 1), C + 3, all);
  add('brand new today', ago(0), 0, {});
  add('plenty of classes but promoted today', ago(0), C + 50, all);
  add('long in rank but no classes', ago(D + 900), 0, all);
  add('half way on classes', ago(D + 400), Math.round(C * 0.5), all);
  add('unreadable date, classes met', 0, 0, all, 'dateOfCurrentRank is a non-null timestamp column');
  add('date in the future, classes met', ago(-400), C + 2, all);
  add('class count missing from the record', 0, 0, all, 'classesAttendedTowardCheckpoint is a non-null Int (default 0)');
  add('class count stored as text', 0, 0, all, 'classesAttendedTowardCheckpoint is a non-null Int');
  add('skill record missing altogether', ago(D + 400), C + 2, {});
  if (req.skills.length) {
    add('skills only at "learning"', ago(D + 400), C + 5, learning);
    add('no skills signed', ago(D + 400), C + 5, {});
    const oneShort = { ...all };
    delete oneShort[req.skills[req.skills.length - 1]];
    add('one skill short', ago(D + 400), C + 5, oneShort);
  }
  return sc;
}

let naCount = 0;
async function suiteEligibility() {
  let ranksDone = 0;
  let scenariosRun = 0;
  for (const st of sweepStyles) {
    // Give the template styles skill gates, as the harness does: two skills on every third rung.
    const a = await mkSkill(st.id, `QA Skill A ${st.tid}`);
    const b = await mkSkill(st.id, `QA Skill B ${st.tid}`);
    let ladder = await refLadder(st.id);
    for (const r of ladder) if (r.idx % 3 === 1) await attachSkills(r.id, [a, b].sort());
    ladder = await refLadder(st.id);

    // One fresh student per (rung, scenario): a student holds one rank per style.
    const plan: Array<{ rung: RefRung; req: RefReq | null; sc: Scenario }> = [];
    for (const rung of ladder) {
      if (rung.idx % SWEEP_RUNG_EVERY !== 0 && rung.idx !== ladder.length - 1) continue;
      const req = refReq(ladder, rung);
      if (!req) {
        [
          { label: 'top: long ago', sinceDay: TODAY_NUM - 7600, classes: 0, skills: {} },
          { label: 'top: today', sinceDay: TODAY_NUM, classes: 40, skills: {} },
          { label: 'top: future date', sinceDay: TODAY_NUM + 50, classes: 160, skills: {} },
          { label: 'top: empty date', sinceDay: 0, classes: 80, skills: {}, na: 'non-null timestamp' },
          { label: 'top: N/A date', sinceDay: 0, classes: 120, skills: {}, na: 'non-null timestamp' },
        ].forEach((sc) => plan.push({ rung, req: null, sc }));
        continue;
      }
      const all = scenariosFor(req).filter((sc) => !sc.na);
      const picked = SWEEP_SCENARIOS > 0 ? Array.from({ length: Math.min(SWEEP_SCENARIOS, all.length) }, (_, k) => all[(rung.idx + k * 7) % all.length]) : scenariosFor(req);
      for (const sc of picked) plan.push({ rung, req, sc });
    }
    const runnable = plan.filter((p) => !p.sc.na);
    naCount += plan.length - runnable.length;
    const students = await mkStudents(runnable.length);
    await seedRanks(runnable.map((p, i) => ({ studentId: students[i], disciplineId: st.id, rung: p.rung, sinceDay: p.sc.sinceDay, classes: p.sc.classes, skills: p.sc.skills })));

    await pool(runnable, 12, async (p, i) => {
      let fam = '';
      const okc = (c: boolean, l: string, d: unknown = '') => ok(c, l, d, fam);
      const eqc = (a: unknown, b: unknown, l: string) => eq(a, b, l, fam);
      const sid = students[i];
      const label = `${st.tid} / ${p.rung.name} — ${p.sc.label}`;
      const stu: RefStu = { sinceDay: p.sc.sinceDay, classesAttended: p.sc.classes, skillStatus: p.sc.skills };
      if (!p.req) {
        fam = '3a top rung';
        const { res, el } = await eligibilityOf(sid, st.id);
        if (okc(res.status === 200, `${label}: eligibility runs`, msg(res))) {
          okc(el && el.hasNext === false, `${label}: top rung reports "no next grade"`, el);
          okc(el && Object.keys(el).filter((k) => k !== 'dataError').length === 1 && el.dataError === false, `${label}: top rung reports nothing else (beyond dataError:false)`, el);
        }
        const same = await promote(sid, st.id, { targetRungId: p.rung.id, acknowledgeWithoutSkillSignoff: true });
        okc(same.status === 400, `${label}: cannot be "graded" to the rung already held`, msg(same));
        const def = await promote(sid, st.id, { acknowledgeWithoutSkillSignoff: true });
        okc(def.status === 400, `${label}: promote with no target at the top is refused`, msg(def));
        const sr = await srOf(sid, st.id);
        eqc(sr?.currentStripeId, p.rung.id, `${label}: still at the top rung afterwards`);
        return;
      }
      scenariosRun++;
      const req = p.req;
      fam = '3b eligibility';
      const { res, el } = await eligibilityOf(sid, st.id);
      if (okc(res.status === 200 && !!el, `${label}: eligibility runs`, msg(res))) {
        eqc(el.eligible, refEligible(req, stu), `${label}: eligible`);
        eqc(el.nextRungId, req.next.id, `${label}: next rung`);
        eqc(el.progressPercent, refPct(req, stu), `${label}: progress %`);
        eqc(el.boardColumn, refBand(refPct(req, stu)), `${label}: board column (33/66 default)`);
        eqc(el.missingSkillIds.length > 0, refSkillsMissing(req, stu), `${label}: "skills not signed" warning`);
        eqc(el.timeOnly, req.timeOnly, `${label}: time-only flag`);
        eqc(el.requiredClasses, req.timeOnly ? 0 : req.classes, `${label}: classes target (panel's "x / N")`);
        eqc(el.requiredDays, req.days, `${label}: days target`);
        eqc(el.elapsedDays, refDays(stu.sinceDay), `${label}: days in rank`);
        eqc([...el.requiredSkillIds].sort(), req.skills.slice().sort(), `${label}: required skills = the next grade's skills`);
        eqc([...el.optionalSkillIds].sort(), req.optionalSkills.slice().sort(), `${label}: optional skills (time-only)`);
        okc(NUMERIC_FIELDS.every((k) => Number.isFinite(el[k])), `${label}: no NaN/null in numeric fields`, el);
        if (req.timeOnly) {
          const shown = Math.floor(((el.elapsedDays || 0) / 365) * 10) / 10;
          const need = Math.round((el.requiredDays || 0) / 365);
          okc(!(shown >= need && el.eligible === false && need > 0), `${label}: years shown never reach the target before the student is eligible`, `${shown} / ${need}`);
        }
      }
      fam = '3c grade to next rung';
      const g = await promote(sid, st.id, { targetRungId: req.next.id, acknowledgeWithoutSkillSignoff: true });
      if (okc(g.status === 201, `${label}: can be graded to ${req.next.name}`, msg(g))) {
        const sr = await srOf(sid, st.id);
        eqc(sr?.currentStripeId, req.next.id, `${label}: rung is now the next rung`);
        eqc(sr && dayOf(sr.dateOfCurrentRank), TODAY, `${label}: time-in-rank clock restarts today`);
        eqc(sr?.classesAttendedTowardCheckpoint, 0, `${label}: class count resets`);
        eqc(sr?.skillStatuses.length, 0, `${label}: skill sign-offs are cleared`);
        const h = sr ? (await eventsOf(sr.id))[0] : null;
        okc(
          !!h && h.type === 'PROMOTION' && h.toStripeTierId === req.next.id && dayOf(h.effectiveDate) === TODAY && h.rungsSkipped === 0 && !h.systemNote,
          `${label}: a promotion is written to the history`,
          h && { type: h.type, to: h.toStripeTierId, eff: h.effectiveDate, skipped: h.rungsSkipped, sys: h.systemNote },
        );
        eqc(h?.acknowledgedWithoutSkillSignoff, refSkillsMissing(req, stu), `${label}: the skills acknowledgement is recorded only when skills were missing`);
        const again = await eligibilityOf(sid, st.id);
        okc(again.res.status === 200, `${label}: eligibility still runs straight after grading`, msg(again.res));
      }
    });
    ranksDone += ladder.length;
  }
  note(`Eligibility and grading checked on ${ranksDone} rungs across ${sweepStyles.length} template styles, ${scenariosRun} scenarios over HTTP; ${naCount} harness scenarios not applicable (typed DB columns).`);
}

// ===========================================================================
// SUITE 4 — Grade and Downgrade rules, on a fresh IBJJF style
// ===========================================================================
let rules: { id: string; ladder: RefRung[]; byName: (n: string) => RefRung; purpleSkills: string[] };
async function setupRulesStyle() {
  const st = await fromTemplate('ibjjf', 'Rules BJJ');
  let ladder = await refLadder(st.id);
  const byName0 = (n: string) => ladder.find((r) => r.name === n)!;
  // As the prototype's seed: Purple Belt needs 5 skills.
  const purpleSkills: string[] = [];
  for (const n of ['Armbar', 'Triangle', 'Kimura', 'Rear Naked Choke', 'Single-leg Takedown']) purpleSkills.push(await mkSkill(st.id, n));
  await attachSkills(byName0('Purple Belt').id, purpleSkills);
  ladder = await refLadder(st.id);
  const byName = (n: string) => {
    const r = ladder.find((x) => x.name === n);
    if (!r) throw new Error(`no rung named ${n}`);
    return r;
  };
  rules = { id: st.id, ladder, byName, purpleSkills };
}
async function student(at: string, opts: { classes?: number; daysAgo?: number; skills?: Record<string, string>; style?: string } = {}) {
  const [sid] = await mkStudents(1);
  const disciplineId = opts.style ?? rules.id;
  const ladder = disciplineId === rules.id ? rules.ladder : await refLadder(disciplineId);
  const rung = ladder.find((r) => r.name === at)!;
  await seedRanks([{ studentId: sid, disciplineId, rung, sinceDay: TODAY_NUM - (opts.daysAgo ?? 400), classes: opts.classes ?? 0, skills: opts.skills ?? {} }]);
  return sid;
}
const snapshot = async (sid: string, d = rules.id) => {
  const sr = await srOf(sid, d);
  return JSON.stringify({ ...sr, updatedAt: undefined, skillStatuses: sr?.skillStatuses.map((s: any) => [s.skillId, s.status]).sort(), events: sr ? (await eventsOf(sr.id)).length : 0 });
};

async function suiteGradeRules() {
  const R = rules;
  const id = (n: string) => R.byName(n).id;

  family('4a up only / same / earlier / unknown');
  let s = await student('Blue Belt · 2 Stripes', { classes: 12 });
  const before = await snapshot(s);
  let r = await promote(s, R.id, { targetRungId: id('Blue Belt · 2 Stripes') });
  ok(r.status === 400, 'grading to the rung already held is refused', msg(r));
  eq(await snapshot(s), before, '…and leaves the student completely unchanged');
  r = await promote(s, R.id, { targetRungId: id('White Belt') });
  ok(r.status === 400, 'grading to an earlier rung is refused (that is a Downgrade)', msg(r));
  eq(await snapshot(s), before, '…and leaves the student completely unchanged');
  r = await promote(s, R.id, { targetRungId: randomUUID() });
  ok(r.status === 400, 'grading to a rung that does not exist is refused', msg(r));
  r = await promote(s, R.id, { targetRungId: R.ladder.find((x) => x.name === 'White Belt')!.id.replace(/.$/, (c) => (c === '0' ? '1' : '0')) });
  ok(r.status >= 400 && r.status < 500, 'grading to a malformed/foreign rung id is refused with a 4xx', msg(r));

  family('4b skipping rungs + starting classes');
  r = await promote(s, R.id, { targetRungId: id('Purple Belt · 1 Stripe'), startingClasses: 7 });
  ok(r.status === 201, 'skipping several rungs is allowed', msg(r));
  let sr = await srOf(s, R.id);
  eq(sr?.currentStripeId, id('Purple Belt · 1 Stripe'), 'the student lands on the picked rung');
  let h = (await eventsOf(sr!.id))[0];
  ok(/Skipped 3 ranks in between/.test(h?.systemNote ?? ''), 'the history says how many rungs were skipped', h?.systemNote);
  eq(h?.rungsSkipped, 3, '…and stores the number');
  eq(sr?.classesAttendedTowardCheckpoint, 7, '"Starting classes" is applied');
  r = await promote(s, R.id, { targetRungId: id('Purple Belt · 2 Stripes') });
  ok(r.status === 201, 'a normal one-rung grade', msg(r));
  h = (await eventsOf(sr!.id))[0];
  ok(!h?.systemNote, 'a one-rung grade carries no "skipped" note', h?.systemNote);

  family('4c grading dates');
  s = await student('White Belt · 1 Stripe', { classes: 8 });
  r = await promote(s, R.id, { targetRungId: id('White Belt · 2 Stripes'), effectiveDate: 'banana' });
  ok(r.status === 400, 'a nonsense grading date is refused', msg(r));
  eq((await srOf(s, R.id))?.currentStripeId, id('White Belt · 1 Stripe'), '…and the student is not graded');
  r = await promote(s, R.id, { targetRungId: id('White Belt · 2 Stripes'), effectiveDate: dayStr(TODAY_NUM + 3) });
  ok(r.status === 400, 'a grading date in the future is refused', msg(r));
  r = await promote(s, R.id, { targetRungId: id('White Belt · 2 Stripes'), effectiveDate: '2026-02-31' });
  ok(r.status === 400, 'an impossible date (31 Feb) is refused', msg(r));
  r = await promote(s, R.id, { targetRungId: id('White Belt · 2 Stripes'), effectiveDate: '14 Jan 2026' });
  ok(r.status === 400, 'a display-format date ("14 Jan 2026") is refused — the API takes YYYY-MM-DD only', msg(r));
  r = await promote(s, R.id, { targetRungId: id('White Belt · 2 Stripes'), effectiveDate: dayStr(TODAY_NUM - 10) });
  ok(r.status === 201, 'a back-dated grading is accepted', msg(r));
  sr = await srOf(s, R.id);
  h = (await eventsOf(sr!.id))[0];
  ok(dayOf(sr!.dateOfCurrentRank) === dayStr(TODAY_NUM - 10) && dayOf(h.effectiveDate) === dayStr(TODAY_NUM - 10), 'the back-dated date is stored on the student and the history', dayOf(sr!.dateOfCurrentRank));
  r = await promote(s, R.id, { targetRungId: id('White Belt · 3 Stripes'), effectiveDate: dayStr(TODAY_NUM - 5) });
  ok(r.status === 201, 'a date typed as YYYY-MM-DD is accepted', msg(r));
  eq(dayOf((await srOf(s, R.id))!.dateOfCurrentRank), dayStr(TODAY_NUM - 5), '…and stored as that day');
  r = await promote(s, R.id, { targetRungId: id('White Belt · 4 Stripes'), effectiveDate: dayStr(TODAY_NUM - 6) });
  ok(r.status === 400 && /current rank/.test(JSON.stringify(r.body)), 'a grading dated before the student reached their current rung is refused, saying why', msg(r));
  eq((await srOf(s, R.id))?.currentStripeId, id('White Belt · 3 Stripes'), '…and the student is not graded');
  r = await promote(s, R.id, { targetRungId: id('White Belt · 4 Stripes'), effectiveDate: dayStr(TODAY_NUM - 5) });
  ok(r.status === 201, 'a grading dated the same day they reached their current rung is accepted', msg(r));
  r = await promote(s, R.id, { targetRungId: id('Grey/White Belt'), effectiveDate: dayStr(TODAY_NUM - 2) });
  ok(r.status === 201, '…and so is a later date', msg(r));
  family('4h history order');
  const hist = await api('GET', `/v1/students/${s}/rank-history?schoolId=${school.id}`);
  const dates: string[] = (hist.body?.items ?? []).map((e: any) => String(e.effectiveDate).slice(0, 10));
  ok(hist.status === 200 && dates.length === 4, 'GET rank-history returns the 4 entries', msg(hist));
  ok(dates.every((d, i) => i === 0 || d <= dates[i - 1]), 'the history runs in date order, newest first (prototype; Decision 185)', dates.join(' > '));

  family('4d into the time-only tier');
  s = await student('Brown Belt · 4 Stripes', { classes: 30 });
  // Decisions 128.3 and 174.1: a time-only stripe takes no starting classes, so the
  // API refuses the field (the prototype ignores it; same outcome, 0 classes).
  r = await promote(s, R.id, { targetRungId: id('Black Belt'), startingClasses: 25 });
  ok(r.status === 400, '"Starting classes" when grading INTO a time-only stripe is refused (Decisions 128.3, 174.1)', msg(r));
  eq((await srOf(s, R.id))?.currentStripeId, id('Brown Belt · 4 Stripes'), '…and the student is not graded');
  r = await promote(s, R.id, { targetRungId: id('Black Belt') });
  ok(r.status === 201, 'Brown Belt · 4 Stripes can be graded to Black Belt', msg(r));
  eq((await srOf(s, R.id))?.classesAttendedTowardCheckpoint, 0, 'classes are zero on a time-only stripe');

  family('4e skills: soft warning and hard block');
  await api('PATCH', `/v1/disciplines/${R.id}`, { skillsRequiredToGrade: false });
  s = await student('Blue Belt · 4 Stripes', { classes: 40 });
  r = await promote(s, R.id, { targetRungId: id('Purple Belt'), acknowledgeWithoutSkillSignoff: false });
  ok(r.status === 400, 'skills missing + warning not acknowledged: grading is refused', msg(r));
  eq((await srOf(s, R.id))?.currentStripeId, id('Blue Belt · 4 Stripes'), '…student unchanged');
  const el0 = (await eligibilityOf(s, R.id)).el;
  eq(el0?.missingSkillIds?.length, 5, 'the warning lists all 5 missing skills');
  r = await promote(s, R.id, { targetRungId: id('Purple Belt'), acknowledgeWithoutSkillSignoff: true });
  ok(r.status === 201, 'skills missing + acknowledged: grading goes ahead', msg(r));
  eq(r.body?.promotionEvent?.acknowledgedWithoutSkillSignoff ?? (await eventsOf((await srOf(s, R.id))!.id))[0]?.acknowledgedWithoutSkillSignoff, true, '…and the acknowledgement is recorded');
  const sw = await api('PATCH', `/v1/disciplines/${R.id}`, { skillsRequiredToGrade: true });
  ok(sw.status === 200, 'the per-style "skills required" switch can be turned on', msg(sw));
  s = await student('Blue Belt · 4 Stripes', { classes: 40 });
  const boardItem = async (sid: string) => {
    const b = await api('GET', `/v1/schools/${school.id}/grading-board?disciplineId=${R.id}&search=${encodeURIComponent('')}`);
    return (b.body?.items ?? []).find((i: any) => i.studentId === sid);
  };
  eq((await boardItem(s))?.hardBlocked, true, 'with "skills required" on, a student missing skills is hard-blocked');
  r = await promote(s, R.id, { targetRungId: id('Purple Belt'), acknowledgeWithoutSkillSignoff: true });
  ok(r.status === 400, 'hard block: grading is refused even when acknowledged', msg(r));
  r = await promote(s, R.id, { targetRungId: id('Brown Belt'), acknowledgeWithoutSkillSignoff: true });
  ok(r.status === 400, 'hard block: skipping past the gated rung is refused too', msg(r));
  for (const k of R.purpleSkills) {
    await api('PATCH', `/v1/students/${s}/skills/${k}`); // NOT_STARTED -> LEARNING
    await api('PATCH', `/v1/students/${s}/skills/${k}`); // LEARNING -> SIGNED_OFF
  }
  eq((await boardItem(s))?.hardBlocked, false, 'once every skill is signed the block lifts');
  r = await promote(s, R.id, { targetRungId: id('Purple Belt'), acknowledgeWithoutSkillSignoff: false });
  ok(r.status === 201, '…and grading goes ahead with no acknowledgement needed', msg(r));
  // time-only rungs: skills are optional, never block
  const rnc = R.purpleSkills[3];
  await attachSkills(id('Black Belt · 4 Stripes'), [rnc]);
  s = await student('Black Belt · 3 Stripes', { daysAgo: 2000 });
  const elB = (await eligibilityOf(s, R.id)).el;
  eq(elB?.eligible, true, 'a Black Belt with time served is eligible although an optional skill is unsigned');
  eq((await boardItem(s))?.hardBlocked, false, '"skills required" never blocks a time-only rung');
  eq(elB?.missingSkillIds?.length, 0, 'no skills warning on a time-only rung');
  r = await promote(s, R.id, { targetRungId: id('Black Belt · 4 Stripes'), acknowledgeWithoutSkillSignoff: false });
  ok(r.status === 201, '…and it can be graded without any acknowledgement', msg(r));
  await api('PATCH', `/v1/disciplines/${R.id}`, { skillsRequiredToGrade: false });
  await attachSkills(id('Black Belt · 4 Stripes'), []);

  family('4g downgrade');
  s = await student('Purple Belt · 2 Stripes', { classes: 14, skills: { [rnc]: 'signed' } });
  const dBefore = await snapshot(s);
  r = await downgrade(s, R.id, { targetRungId: id('Blue Belt · 4 Stripes') });
  ok(r.status === 400, 'downgrade with no reason does nothing (400)', msg(r));
  r = await downgrade(s, R.id, { targetRungId: id('Blue Belt · 4 Stripes'), reason: '   ' });
  ok(r.status === 400, 'a reason of only spaces does not count', msg(r));
  r = await downgrade(s, R.id, { targetRungId: id('Brown Belt'), reason: 'Returning after a long break' });
  ok(r.status === 400, '"downgrading" to a higher rung is refused', msg(r));
  r = await downgrade(s, R.id, { targetRungId: id('Purple Belt · 2 Stripes'), reason: 'Returning after a long break' });
  ok(r.status === 400, '"downgrading" to the same rung is refused', msg(r));
  eq(await snapshot(s), dBefore, '…none of those changed anything or wrote history');
  r = await downgrade(s, R.id, { targetRungId: id('Blue Belt · 4 Stripes'), reason: 'Returning after a long break' });
  ok(r.status === 201, 'a valid downgrade moves the student', msg(r));
  sr = await srOf(s, R.id);
  eq(sr?.currentStripeId, id('Blue Belt · 4 Stripes'), '…to the picked rung');
  h = (await eventsOf(sr!.id))[0];
  ok(h?.type === 'DOWNGRADE' && h?.reason === 'Returning after a long break', 'the reason is stored on a DOWNGRADE history entry', h && { type: h.type, reason: h.reason });
  ok(sr!.classesAttendedTowardCheckpoint === 0 && sr!.skillStatuses.length === 0 && dayOf(sr!.dateOfCurrentRank) === TODAY, 'a downgrade resets classes, sign-offs and the clock');
  r = await downgrade(s, R.id, { targetRungId: id('Blue Belt · 3 Stripes'), reason: 'x', effectiveDate: dayStr(TODAY_NUM - 1) });
  ok(r.status === 400, 'a downgrade is always dated today (no back-dating)', msg(r));
  s = await student('White Belt');
  r = await downgrade(s, R.id, { reason: 'x' });
  ok(r.status === 400, 'at the first rung there is nothing to downgrade to', msg(r));

  family('4h history note and void');
  s = await student('White Belt', { classes: 8 });
  await promote(s, R.id, { targetRungId: id('White Belt · 1 Stripe') });
  await promote(s, R.id, { targetRungId: id('White Belt · 2 Stripes'), note: 'Great guard passing' });
  sr = await srOf(s, R.id);
  const evs = await eventsOf(sr!.id);
  eq(evs[0]?.note, 'Great guard passing', 'a grader\'s note is stored on the history entry (given when grading)');
  const older = evs[1];
  r = await api('POST', `/v1/students/${s}/rank-history/${older.id}/void?schoolId=${school.id}`, {});
  ok(r.status === 400, 'voiding (the API\'s "delete") needs a reason', msg(r));
  r = await api('POST', `/v1/students/${s}/rank-history/${older.id}/void?schoolId=${school.id}`, { reason: 'entered twice' });
  ok(r.status === 201, 'an entry can be voided with a reason (Decision 129)', msg(r));
  const hv = await api('GET', `/v1/students/${s}/rank-history?schoolId=${school.id}`);
  ok((hv.body?.items ?? []).length === 1 && hv.body.items[0].toStripeTierId === id('White Belt · 2 Stripes'), 'the voided entry leaves the normal history; exactly that entry', hv.body?.items?.map((e: any) => e.id));
  eq((await srOf(s, R.id))?.currentStripeId, id('White Belt · 2 Stripes'), 'voiding a history entry does not change the student\'s rank');

  family('4i API defaults (observation)');
  s = await student('Blue Belt · 2 Stripes', { classes: 12 });
  r = await promote(s, R.id, {});
  sr = await srOf(s, R.id);
  note(`Promote with no targetRungId from Blue Belt · 2 Stripes: ${msg(r).slice(0, 80)}; lands on ${R.ladder.find((x) => x.id === sr?.currentStripeId)?.name}. The prototype's Grade window opens on the NEXT rung (Blue Belt · 3 Stripes).`);
  s = await student('Purple Belt · 2 Stripes', { classes: 3 });
  r = await downgrade(s, R.id, { reason: 'default target check' });
  sr = await srOf(s, R.id);
  note(`Downgrade with no targetRungId from Purple Belt · 2 Stripes: ${msg(r).slice(0, 40)}; lands on ${R.ladder.find((x) => x.id === sr?.currentStripeId)?.name}. The prototype's Downgrade window opens on the rung just below (Purple Belt · 1 Stripe).`);
}

// ===========================================================================
// SUITE 5 — student panel data: skills, classes, days
// ===========================================================================
async function suiteStudentPanel() {
  const R = rules;
  family('5a sign-off makes eligible');
  const [a, b, c, d, e] = R.purpleSkills;
  const alex = await student('Blue Belt · 4 Stripes', { classes: 40, daysAgo: 300, skills: { [a]: 'signed', [b]: 'signed', [c]: 'signed', [d]: 'signed', [e]: 'learning' } });
  let el = (await eligibilityOf(alex, R.id)).el;
  eq([...el.requiredSkillIds].sort(), R.purpleSkills.slice().sort(), 'the panel lists the 5 skills needed for Purple');
  eq(el.requiredSkillIds.length - el.missingSkillIds.length, 4, 'the panel shows 4 of 5 skills signed');
  eq(el.eligible, false, 'not eligible yet');
  let r = await api('PATCH', `/v1/students/${alex}/skills/${e}`);
  ok(r.status === 200 || r.status === 201, 'signing the fifth skill', msg(r));
  eq((await srOf(alex, R.id))?.skillStatuses.find((x: any) => x.skillId === e)?.status, 'SIGNED_OFF', 'one click moves "Learning" to signed');
  el = (await eligibilityOf(alex, R.id)).el;
  eq(el.eligible, true, 'the student becomes eligible');
  r = await api('PATCH', `/v1/students/${alex}/skills/${e}`);
  eq((await srOf(alex, R.id))?.skillStatuses.find((x: any) => x.skillId === e)?.status, 'NOT_STARTED', 'clicking again cycles back to "not started"');
  eq((await eligibilityOf(alex, R.id)).el.eligible, false, '…and eligibility is withdrawn');
  r = await api('PATCH', `/v1/students/${alex}/skills/${R.byName('Purple Belt').id === '' ? '' : randomUUID()}`);
  ok(r.status === 404 || r.status === 400, 'a sign-off on a skill that does not exist is refused', msg(r));

  family('5b brown 4 → black target, log a class');
  const s = await student('Brown Belt · 4 Stripes', { classes: 10, daysAgo: 400 });
  el = (await eligibilityOf(s, R.id)).el;
  ok(el.requiredClasses === 26 && el.countedClasses === 10, 'Brown Belt · 4 Stripes shows "10 / 26" classes toward Black Belt (not "10 / 0")', `${el.countedClasses} / ${el.requiredClasses}`);
  let logged = 0;
  for (let i = 0; i < 16; i++) {
    const lr = await api('POST', `/v1/students/${s}/ranks/${R.id}/log-class`, { classType: 'Adult Fundamentals' });
    if (lr.status === 201) logged++;
    else if (i === 0) ok(false, 'log-class answers 201', msg(lr));
  }
  eq((await srOf(s, R.id))?.classesAttendedTowardCheckpoint, 26, 'sixteen "Log a class" add sixteen classes');
  eq((await eligibilityOf(s, R.id)).el.eligible, true, 'reaching the class target (with the days already served) makes the student eligible');
  const lr0 = await api('POST', `/v1/students/${s}/ranks/${R.id}/log-class`, {});
  ok(lr0.status === 400, 'log-class without a class type is refused when the next rung ticks types (Decision 176)', msg(lr0));

  family('5c minimum days shown and enforced');
  const g = await student('Grey Belt · 2 Stripes', { classes: 50, daysAgo: 10 });
  el = (await eligibilityOf(g, R.id)).el;
  ok(el.elapsedDays === 10 && el.requiredDays === 73, 'the panel shows days in rank against the minimum (10 / 73)', `${el.elapsedDays} / ${el.requiredDays}`);
  eq(el.eligible, false, 'enough classes but too few days: not eligible');
  r = await api('PATCH', `/v1/students/${g}/ranks/${R.id}/rank-date`, { date: dayStr(TODAY_NUM - 73) });
  ok(r.status === 200, 'the rank date can be corrected (Decision 153)', msg(r));
  eq((await eligibilityOf(g, R.id)).el.eligible, true, 'on the 73rd day the student becomes eligible');
}

// ===========================================================================
// SUITE 6 — Grading Board with 600 students, bulk promote, drags
// ===========================================================================
async function suiteBoard(seed: number) {
  const rand = rng(seed);
  const st = await fromTemplate('ibjjf', 'Board BJJ');
  const rnc = await mkSkill(st.id, 'rnc');
  const ss = await mkSkill(st.id, 'ss');
  let ladder = await refLadder(st.id);
  for (const r of ladder) if (r.idx % 5 === 3 && !r.timeOnly) await attachSkills(r.id, [rnc, ss].sort());
  ladder = await refLadder(st.id);
  const first = ['Ana', 'Ben', 'Caio', 'Dana', 'Eli', 'Fay', 'Gil', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lia', 'Max', 'Noa', 'Oto', 'Pia', 'Rui', 'Sam', 'Tai', 'Uma', 'Vic', 'Wes', 'Yara', 'Zed'];
  const last = ['Silva', 'Costa', 'Lima', 'Rocha', 'Souza', 'Alves', 'Dias', 'Melo', 'Nunes', 'Pinto', 'Reis', 'Teles'];
  type P = { sid: string; first: string; surname: string; rung: RefRung; stu: RefStu; active: boolean };
  const people: P[] = [];
  const N = 600;
  const specs: Array<Omit<P, 'sid'>> = [];
  for (let i = 0; i < N; i++) {
    const rung = ladder[Math.floor(rand() * ladder.length)];
    const req = refReq(ladder, rung);
    const cls = req && !req.timeOnly ? Math.floor(rand() * (req.classes * 1.4 + 1)) : Math.floor(rand() * 100);
    const days = req ? Math.floor(rand() * (req.days * 1.5 + 30)) : Math.floor(rand() * 3000);
    const skills: Record<string, string> = {};
    if (req)
      (req.timeOnly ? req.optionalSkills : req.skills).forEach((k) => {
        const x = rand();
        skills[k] = x < 0.5 ? 'signed' : x < 0.75 ? 'learning' : 'not_started';
      });
    const f = first[Math.floor(rand() * first.length)];
    const l = last[Math.floor(rand() * last.length)];
    // Time-only rungs count no classes in the API (Decision 128 item 3); keep the
    // stored count as the harness does — it must not matter.
    specs.push({ first: f, surname: `${l} ${i + 1}`, rung, stu: { sinceDay: TODAY_NUM - days, classesAttended: cls, skillStatus: skills }, active: rand() > 0.12 });
  }
  const ids = await mkStudents(N, (i) => [specs[i].first, specs[i].surname]);
  specs.forEach((sp, i) => people.push({ sid: ids[i], ...sp }));
  await seedRanks(people.map((p) => ({ studentId: p.sid, disciplineId: st.id, rung: p.rung, sinceDay: p.stu.sinceDay, classes: p.stu.classesAttended, skills: p.stu.skillStatus, active: p.active })));
  const reqOf = (p: P) => refReq(ladder, p.rung);
  const boardGet = (q: string) => api('GET', `/v1/schools/${school.id}/grading-board?disciplineId=${st.id}${q}`);

  family('6a columns, % and warnings');
  let t0 = Date.now();
  let b = await boardGet('&activeOnly=true');
  const ms600 = Date.now() - t0;
  note(`Grading Board GET with 600 students (owner): ${ms600} ms.`);
  ok(b.status === 200 && ms600 < 10_000, 'the board answers for 600 students in under 10 seconds', `${b.status} ${ms600} ms`);
  const want: Record<string, string[]> = { JUST_STARTING: [], GETTING_THERE: [], READY_TO_GRADE: [] };
  let atTop = 0;
  for (const p of people) {
    if (!p.active) continue;
    const req = reqOf(p);
    if (!req) {
      atTop++;
      continue;
    }
    want[refBand(refPct(req, p.stu))].push(p.sid);
  }
  const items: any[] = b.body?.items ?? [];
  const cols = (its: any[]) => {
    const o: Record<string, string[]> = { JUST_STARTING: [], GETTING_THERE: [], READY_TO_GRADE: [] };
    its.forEach((i) => o[i.eligibility.boardColumn]?.push(i.studentId));
    return o;
  };
  const c0 = cols(items);
  for (const k of Object.keys(want)) eq(c0[k].slice().sort(), want[k].slice().sort(), `column "${k}" holds exactly the students the rules put there (${want[k].length})`);
  ok(!items.some((i) => people.find((p) => p.sid === i.studentId && !reqOf(p))), `students at the top rung (${atTop} active) are not shown`);
  const inactiveAll = people.filter((p) => !p.active).length;
  const inactiveWithNext = people.filter((p) => !p.active && reqOf(p)).length;
  eq(b.body?.hiddenInactive, inactiveAll, `the board says ${inactiveAll} inactive students are hidden (prototype counts every inactive student, top rung included)`);
  note(`hiddenInactive: API ${b.body?.hiddenInactive}; inactive with a next rung ${inactiveWithNext}; all inactive ${inactiveAll}.`);
  const cardBad: string[] = [];
  for (const i of items) {
    const p = people.find((x) => x.sid === i.studentId)!;
    const req = reqOf(p)!;
    if (i.eligibility.progressPercent !== refPct(req, p.stu)) cardBad.push(`${p.surname} ${i.eligibility.progressPercent}% expected ${refPct(req, p.stu)}%`);
    const skillWarn = !i.eligibility.timeOnly && i.eligibility.missingSkillIds.length > 0;
    if (skillWarn !== refSkillsMissing(req, p.stu)) cardBad.push(`${p.surname} skills warning ${skillWarn}`);
    const early = !i.eligibility.timeOnly && !i.eligibility.daysOk;
    const refEarly = !req.timeOnly && refDays(p.stu.sinceDay) < req.days;
    if (early !== refEarly) cardBad.push(`${p.surname} days warning ${early} expected ${refEarly}`);
  }
  eq(cardBad.length, 0, `every card shows the right %, skills warning and "too early" warning ${cardBad.slice(0, 4).join(' | ')}`);
  let orderOk = true;
  for (let k = 1; k < items.length; k++) if (items[k].eligibility.progressPercent > items[k - 1].eligibility.progressPercent) orderOk = false;
  ok(orderOk, 'the board is sorted with the most advanced student first (so each column is too)');

  family('6b search and filters');
  b = await boardGet('&activeOnly=true&search=silva');
  const shown = (b.body?.items ?? []).map((i: any) => i.studentId).sort();
  const expectShown = people.filter((p) => p.active && reqOf(p) && `${p.first} ${p.surname}`.toLowerCase().includes('silva')).map((p) => p.sid).sort();
  eq(shown, expectShown, `searching "silva" shows exactly the matching students (${expectShown.length})`);
  eq(b.body?.hiddenInactive, inactiveAll, 'the "inactive hidden" count is not changed by searching (prototype)');
  note(`hiddenInactive while searching "silva": API ${b.body?.hiddenInactive}.`);
  b = await boardGet('&activeOnly=true&search=SILVA%201');
  ok((b.body?.items ?? []).length > 0, 'search ignores upper/lower case');
  b = await boardGet('&activeOnly=true&search=zzzz-no-such-name');
  eq((b.body?.items ?? []).length, 0, 'a search with no match shows an empty board');
  b = await boardGet('');
  eq((b.body?.items ?? []).length, people.filter((p) => reqOf(p)).length, 'turning the filter off shows inactive students too');

  family('6c skills required: padlocks');
  await api('PATCH', `/v1/disciplines/${st.id}`, { skillsRequiredToGrade: true });
  b = await boardGet('&activeOnly=true');
  const blockedIds = people.filter((p) => p.active && reqOf(p) && refSkillsMissing(reqOf(p)!, p.stu)).map((p) => p.sid);
  ok(blockedIds.length > 10, `the test school has students blocked by skills (${blockedIds.length})`);
  eq((b.body?.items ?? []).filter((i: any) => i.hardBlocked).map((i: any) => i.studentId).sort(), blockedIds.slice().sort(), 'every skills-blocked student is flagged hardBlocked (padlock)');

  family('6d bulk promote');
  const batchAll = want.READY_TO_GRADE.filter((sid) => !blockedIds.includes(sid)).slice(0, 41);
  const removed = batchAll[batchAll.length - 1];
  const batch = batchAll.slice(0, 40);
  const sneaked = blockedIds.slice(0, 3);
  const snap: Record<string, { rung: string; next: string; hist: number; srId: string }> = {};
  for (const sid of [...batchAll, ...sneaked]) {
    const p = people.find((x) => x.sid === sid)!;
    const sr = await srOf(sid, st.id);
    snap[sid] = { rung: p.rung.id, next: reqOf(p)!.next.id, hist: (await eventsOf(sr!.id)).length, srId: sr!.id };
  }
  const studentIds = [...batch, ...sneaked];
  const bulk = (body: object) => api('POST', `/v1/schools/${school.id}/grading/bulk-promote`, { disciplineId: st.id, studentIds, ...body });
  const unchanged = async () => {
    for (const sid of studentIds) if ((await srOf(sid, st.id))?.currentStripeId !== snap[sid].rung) return false;
    return true;
  };
  // a batch date earlier than one student's rank date stops the whole batch
  const recent = batch[0];
  const recentSr = await srOf(recent, st.id);
  await su.studentRank.update({ where: { id: recentSr!.id }, data: { dateOfCurrentRank: instantDaysAgo(3) } });
  let br = await bulk({ effectiveDate: dayStr(TODAY_NUM - 5), acknowledgedStudentIds: studentIds });
  ok(br.status === 400 && /current rank/.test(JSON.stringify(br.body)) && (await unchanged()), 'a batch date earlier than the day one of the students reached their rank stops the whole batch', msg(br));
  await su.studentRank.update({ where: { id: recentSr!.id }, data: { dateOfCurrentRank: recentSr!.dateOfCurrentRank } });
  br = await bulk({ effectiveDate: 'tomorrow-ish', acknowledgedStudentIds: studentIds });
  ok(br.status === 400 && (await unchanged()), 'a nonsense date stops the whole batch', msg(br));
  br = await bulk({ effectiveDate: dayStr(TODAY_NUM + 2), acknowledgedStudentIds: studentIds });
  ok(br.status === 400 && (await unchanged()), 'a future date stops the whole batch', msg(br));
  // Decision 130: a dry run lists "Needs a look" (days short / skills) and "can't be promoted".
  br = await bulk({ dryRun: true });
  ok(br.status === 201 || br.status === 200, 'dry run answers', msg(br));
  const cannot = (br.body?.cannotPromote ?? []).map((x: any) => x.studentId).sort();
  eq(cannot, sneaked.slice().sort(), 'dry run: exactly the 3 skills-blocked students can\'t be promoted');
  const flagged = (br.body?.needsAcknowledgement ?? []) as Array<{ studentId: string; reasons: string[] }>;
  const wantFlag = batch.filter((sid) => {
    const p = people.find((x) => x.sid === sid)!;
    const req = reqOf(p)!;
    return refDays(p.stu.sinceDay) < req.days;
  });
  eq(flagged.map((f) => f.studentId).sort(), wantFlag.slice().sort(), `dry run: "Needs a look" = the Ready students still short of minimum days (${wantFlag.length}) (Decision 130)`);
  const reasonBad = flagged.filter((f) => {
    const p = people.find((x) => x.sid === f.studentId)!;
    const req = reqOf(p)!;
    const short = req.days - refDays(p.stu.sinceDay);
    return !f.reasons.includes(`${short} day${short > 1 ? 's' : ''} short`);
  });
  eq(reasonBad.length, 0, 'dry run: each flagged student\'s reason states the right number of days short');
  ok(await unchanged(), 'dry run changes nothing');
  if (wantFlag.length) {
    br = await bulk({ note: 'Spring Grading' });
    ok(br.status === 400 && (await unchanged()), 'without acknowledging the flagged students the batch is refused (Decision 130)', msg(br));
  }
  br = await bulk({ note: 'Spring Grading', acknowledgedStudentIds: flagged.map((f) => f.studentId) });
  ok(br.status === 201 || br.status === 200, 'with a valid date and the acknowledgement the batch goes through', msg(br));
  const promotedRows: any[] = br.body?.ready ?? [];
  const bad: string[] = [];
  for (const sid of batch) {
    const sr = await srOf(sid, st.id);
    const evs = await eventsOf(sr!.id);
    const h = evs[0];
    if (sr!.currentStripeId !== snap[sid].next) bad.push(`${sid} rung`);
    if (dayOf(sr!.dateOfCurrentRank) !== TODAY || sr!.classesAttendedTowardCheckpoint !== 0 || sr!.skillStatuses.length) bad.push(`${sid} not reset`);
    if (!h || !['BULK_PROMOTION', 'BULK_STRIPE_AWARD'].includes(h.type) || h.note !== 'Spring Grading' || dayOf(h.effectiveDate) !== TODAY || evs.length !== snap[sid].hist + 1) bad.push(`${sid} history`);
  }
  eq(bad.length, 0, `all ${batch.length} students moved up exactly one rung, reset, with the note and date on their history ${bad.slice(0, 3).join(' | ')}`);
  let sneakedOk = true;
  for (const sid of sneaked) if ((await srOf(sid, st.id))?.currentStripeId !== snap[sid].rung) sneakedOk = false;
  ok(sneakedOk, 'the skills-blocked students were NOT promoted');
  eq((await srOf(removed, st.id))?.currentStripeId, snap[removed].rung, 'a student left out of the batch was not promoted');
  eq(promotedRows.length, batch.length, 'the result lists exactly the students promoted');
  eq((br.body?.cannotPromote ?? []).length, 3, 'the result names the 3 students who were held back');
  ok(promotedRows.every((row) => row.fromRungId === snap[row.studentId]?.rung), 'the result remembers each student\'s previous rung');
  const inOrder = JSON.stringify(promotedRows.map((row) => row.studentId)) === JSON.stringify(batch.filter((sid) => promotedRows.some((row) => row.studentId === sid)));
  note(`Bulk promote response order equals the request (calling) order: ${inOrder}. (The printable report is built by the portal from its own order.)`);
  await api('PATCH', `/v1/disciplines/${st.id}`, { skillsRequiredToGrade: false });

  family('6e drags');
  const curState = async (p: P): Promise<{ stu: RefStu; sr: any; hist: number }> => {
    const sr = await srOf(p.sid, st.id);
    const skillStatus: Record<string, string> = {};
    sr!.skillStatuses.forEach((x: any) => (skillStatus[x.skillId] = FROM_STATUS[x.status]));
    return { sr, stu: { sinceDay: dayNumOf(sr!.dateOfCurrentRank), classesAttended: sr!.classesAttendedTowardCheckpoint, skillStatus }, hist: (await eventsOf(sr!.id)).length };
  };
  // Re-read who is where after the bulk promote.
  for (const p of people) {
    const sr = await srOf(p.sid, st.id);
    p.rung = ladder.find((r) => r.id === sr!.currentStripeId)!;
  }
  const sample = people.filter((p) => p.active && reqOf(p)).slice(0, DRAG_SAMPLE);
  const dragBad: string[] = [];
  let dragTried = 0;
  let sameNoop = 0;
  let sameStatus = '';
  for (const p of sample) {
    const req = reqOf(p)!;
    let s0 = await curState(p);
    const nowBand = refBand(refPct(req, s0.stu));
    const own = await api('POST', `/v1/students/${p.sid}/ranks/${st.id}/board-move`, { column: nowBand });
    let s1 = await curState(p);
    if (JSON.stringify([s1.stu, s1.hist]) === JSON.stringify([s0.stu, s0.hist])) sameNoop++;
    else dragBad.push(`${p.surname} changed by a drop on its own column`);
    sameStatus = sameStatus || String(own.status);
    for (const target of ['JUST_STARTING', 'GETTING_THERE', 'READY_TO_GRADE']) {
      s0 = await curState(p);
      const total = req.timeOnly ? req.days : req.classes;
      const beforeBand = refBand(refPct(req, s0.stu));
      const mv = await api('POST', `/v1/students/${p.sid}/ranks/${st.id}/board-move`, { column: target });
      dragTried++;
      s1 = await curState(p);
      if (mv.status >= 500) dragBad.push(`${p.surname} 5xx ${msg(mv)}`);
      const afterBand = refBand(refPct(req, s1.stu));
      const changed = s1.stu.classesAttended !== s0.stu.classesAttended || s1.stu.sinceDay !== s0.stu.sinceDay;
      if (beforeBand === target) {
        if (changed) dragBad.push(`${p.surname} same-band drop changed data`);
        continue;
      }
      if (total >= 3 && afterBand !== target) dragBad.push(`${p.surname} (${p.rung.name}) dropped on ${target} landed in ${afterBand} [${msg(mv)}]`);
      if (changed) {
        const h = (await eventsOf(s1.sr.id))[0];
        if (s1.hist !== s0.hist + 1 || h.type !== 'ADJUSTMENT' || dayOf(h.effectiveDate) !== TODAY) dragBad.push(`${p.surname} moved without a history entry`);
      }
      if (!changed && s1.hist !== s0.hist) dragBad.push(`${p.surname} history written with no change`);
      if (s1.sr.currentStripeId !== p.rung.id) dragBad.push(`${p.surname} rung changed by a drag`);
      // the API's own column must agree with the reference after the move
      const el = (await eligibilityOf(p.sid, st.id)).el;
      if (el.boardColumn !== afterBand) dragBad.push(`${p.surname} API column ${el.boardColumn} vs ref ${afterBand}`);
    }
  }
  eq(dragBad.length, 0, `${dragTried} drags: each lands in the target column, is logged once, and never changes the rung ${dragBad.slice(0, 4).join(' | ')}`);
  eq(sameNoop, sample.length, `dropping a card on the column it is already in changes nothing (${sample.length} students; API status ${sameStatus})`);
  const top = people.find((p) => !reqOf(p));
  if (top) {
    const before = JSON.stringify(await curState(top));
    const r1 = await api('POST', `/v1/students/${top.sid}/ranks/${st.id}/board-move`, { column: 'READY_TO_GRADE' });
    const r2 = await api('POST', `/v1/students/${randomUUID()}/ranks/${st.id}/board-move`, { column: 'READY_TO_GRADE' });
    const r3 = await api('POST', `/v1/students/${people[0].sid}/ranks/${st.id}/board-move`, { column: 'NO_SUCH_COLUMN' });
    ok(r1.status === 400 && r2.status >= 400 && r2.status < 500 && r3.status === 400, 'dragging a top-rung student, an unknown student or onto an unknown column is refused', [r1.status, r2.status, r3.status]);
    eq(JSON.stringify(await curState(top)), before, '…and changes nothing');
  }
}

// ===========================================================================
// SUITE 10 — hostile and awkward text, stored exactly
// ===========================================================================
const NASTY = [
  '<img src=x onerror="window.__xss=1">',
  '"><script>window.__xss=1</script>',
  "'); window.__xss=1; ('",
  "' onmouseover='window.__xss=1",
  '</textarea><svg onload="window.__xss=1">',
  'Tom & Jerry',
  'O\'Neil "The Hammer" <b>Jr</b>',
  '&amp; &lt;b&gt; &#39;',
  'João Conceição ñ 日本語 😀',
  "\\' \\\" \\n",
  '${7*7} {{7*7}}',
  'A'.repeat(600),
];
async function suiteHostile() {
  const R = rules;
  const belt = R.byName('Grey Belt');
  let i = 0;
  for (const text of NASTY) {
    i++;
    const tag = `text #${i}${text.length > 60 ? ' (600 chars)' : ''}`;
    family('10a stored exactly as typed');
    const d = await api('PATCH', `/v1/disciplines/${R.id}`, { name: text });
    if (text.length <= 100) ok(d.status === 200 && d.body?.name === text, `${tag}: the style name is stored exactly as typed`, msg(d));
    else note(`${tag}: style name refused with ${d.status} (MaxLength 100)`);
    const rk = await api('PATCH', `/v1/ranks/${belt.rankId}`, { name: text.slice(0, 600) });
    if (text.length <= 100) ok(rk.status === 200 && rk.body?.name === text, `${tag}: the belt name is stored exactly as typed`, msg(rk));
    else note(`${tag}: belt name refused with ${rk.status}`);
    const sk = await api('POST', `/v1/styles/${R.id}/skills`, { name: text });
    if (text.length <= 150) ok(sk.status === 201 && sk.body?.name === text, `${tag}: the skill name is stored exactly as typed`, msg(sk));
    else note(`${tag}: skill name refused with ${sk.status} (MaxLength 150)`);
    const s = await student('White Belt', { classes: 8 });
    const g = await promote(s, R.id, { targetRungId: R.byName('White Belt · 1 Stripe').id, note: text });
    ok(g.status === 201 && g.body?.promotionEvent?.note === text, `${tag}: the history note is stored exactly`, msg(g));
    if (text.trim()) {
      const dg = await downgrade(s, R.id, { targetRungId: R.byName('White Belt').id, reason: text });
      ok(dg.status === 201 && dg.body?.promotionEvent?.reason === text, `${tag}: the downgrade reason is stored exactly (prototype trims it)`, msg(dg));
    }
    const sb = await api('GET', `/v1/schools/${school.id}/grading-board?disciplineId=${R.id}&search=${encodeURIComponent(text)}`);
    ok(sb.status === 200, `${tag}: the board search accepts the text`, msg(sb));
  }
  await api('PATCH', `/v1/disciplines/${R.id}`, { name: 'Rules BJJ' });
  await api('PATCH', `/v1/ranks/${belt.rankId}`, { name: 'Grey Belt' });
  family('10b padded text');
  const pd = await api('PATCH', `/v1/disciplines/${R.id}`, { name: '  Padded Style  ' });
  note(`A style name typed with surrounding spaces is stored as ${JSON.stringify(pd.body?.name)} (prototype stores text.trim()).`);
  await api('PATCH', `/v1/disciplines/${R.id}`, { name: 'Rules BJJ' });
}

// ===========================================================================
// SUITES 11–13 — random actions, invariants after each
// ===========================================================================
async function suiteRandom(seed: number, steps: number) {
  family('11 random actions');
  const rand = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const maybe = (p: number) => rand() < p;
  const st = await fromTemplate('ibjjf', `Random ${seed}`);
  const sk = [await mkSkill(st.id, 'R1'), await mkSkill(st.id, 'R2'), await mkSkill(st.id, 'R3')];
  let ladder = await refLadder(st.id);
  for (const r of ladder) if (r.idx % 4 === 2) await attachSkills(r.id, maybe(0.5) ? [sk[0]] : [sk[1], sk[2]]);
  ladder = await refLadder(st.id);
  const sids = await mkStudents(30);
  await seedRanks(
    sids.map((sid) => ({
      studentId: sid,
      disciplineId: st.id,
      rung: pick(ladder),
      sinceDay: TODAY_NUM - Math.floor(rand() * 900),
      classes: Math.floor(rand() * 60),
      skills: maybe(0.5) ? { [pick(sk)]: pick(['signed', 'learning', 'not_started']) } : {},
    })),
  );
  const someDate = () => (maybe(0.15) ? pick(['', 'nope', '2026-02-31', dayStr(TODAY_NUM + 5)]) : dayStr(TODAY_NUM - Math.floor(rand() * 400)));
  const someText = () => (maybe(0.08) ? '' : maybe(0.08) ? pick(NASTY) : pick(['Alpha', 'Kimura', 'Guard', 'Sweep', 'Open Mat']) + ' ' + Math.floor(rand() * 1000));
  const anyRung = () => (maybe(0.05) ? randomUUID() : pick(ladder).id);
  const anyStudent = () => (maybe(0.03) ? randomUUID() : pick(sids));
  const counts: Record<string, Record<string, number>> = {};
  let fivexx = 0;
  const firstProblems: string[] = [];
  const actions: Record<string, () => Promise<Res>> = {
    promote: () => promote(anyStudent(), st.id, { targetRungId: maybe(0.1) ? undefined : anyRung(), acknowledgeWithoutSkillSignoff: maybe(0.7), ...(maybe(0.3) ? { effectiveDate: someDate() } : {}), ...(maybe(0.2) ? { startingClasses: Math.floor(rand() * 20) } : {}), ...(maybe(0.3) ? { note: someText() } : {}) }),
    downgrade: () => downgrade(anyStudent(), st.id, { targetRungId: maybe(0.1) ? undefined : anyRung(), reason: someText() }),
    stripe: () => api('POST', `/v1/students/${anyStudent()}/ranks/${st.id}/stripe-award`, { acknowledgeWithoutSkillSignoff: maybe(0.7) }),
    logClass: () => api('POST', `/v1/students/${anyStudent()}/ranks/${st.id}/log-class`, { classType: pick([null, 'Adult Fundamentals', 'Kids Fundamentals', 'Adult Sparring', 'Bogus']) }),
    move: () => api('POST', `/v1/students/${anyStudent()}/ranks/${st.id}/board-move`, { column: pick(['JUST_STARTING', 'GETTING_THERE', 'READY_TO_GRADE', 'NOPE']) }),
    skill: () => api('PATCH', `/v1/students/${anyStudent()}/skills/${maybe(0.05) ? randomUUID() : pick(sk)}`),
    rankDate: () => api('PATCH', `/v1/students/${anyStudent()}/ranks/${st.id}/rank-date`, { date: someDate() }),
    active: () => api('PUT', `/v1/students/${anyStudent()}/ranks/${st.id}/board-active`, { active: pick([true, false, null]) }),
    voidEntry: async () => {
      const sid = anyStudent();
      const evs = await su.promotionEvent.findMany({ where: { studentId: sid, schoolId: school.id }, select: { id: true } });
      const eid = evs.length && maybe(0.9) ? pick(evs).id : randomUUID();
      return api('POST', `/v1/students/${sid}/rank-history/${eid}/void?schoolId=${school.id}`, { reason: someText() });
    },
    bulk: () => api('POST', `/v1/schools/${school.id}/grading/bulk-promote`, { disciplineId: st.id, studentIds: [...new Set([pick(sids), pick(sids), pick(sids)])], dryRun: maybe(0.5), acknowledgedStudentIds: maybe(0.5) ? sids : [] }),
  };
  const names = Object.keys(actions).filter((n) => n !== 'bulk');
  const skillSet = new Set(sk);
  const ladderIds = new Map(ladder.map((r) => [r.id, r]));
  const invariant = async (): Promise<string[]> => {
    const probs: string[] = [];
    const srs = await su.studentRank.findMany({ where: { disciplineId: st.id }, include: { skillStatuses: true } });
    for (const sr of srs) {
      const rung = sr.currentStripeId ? ladderIds.get(sr.currentStripeId) : null;
      if (!rung) probs.push(`${sr.studentId}: rung not on ladder`);
      else if (rung.rankId !== sr.currentRankId) probs.push(`${sr.studentId}: currentRankId does not match the rung's belt`);
      if (!(Number.isInteger(sr.classesAttendedTowardCheckpoint) && sr.classesAttendedTowardCheckpoint >= 0)) probs.push(`${sr.studentId}: classes=${sr.classesAttendedTowardCheckpoint}`);
      if (Object.values((sr.classesAttendedByType ?? {}) as Record<string, number>).some((n) => !(Number.isInteger(n) && n >= 0))) probs.push(`${sr.studentId}: byType`);
      if (dayNumOf(sr.dateOfCurrentRank) > TODAY_NUM) probs.push(`${sr.studentId}: rank date in the future`);
      if (sr.skillStatuses.some((x: any) => !skillSet.has(x.skillId))) probs.push(`${sr.studentId}: sign-off for a skill of another style`);
    }
    const evs = await su.promotionEvent.findMany({ where: { studentRank: { disciplineId: st.id } } });
    const okTypes = ['PROMOTION', 'DOWNGRADE', 'STRIPE_AWARD', 'ADJUSTMENT', 'BULK_PROMOTION', 'BULK_STRIPE_AWARD', 'SELF_DECLARED', 'RANK_CORRECTION'];
    for (const e of evs) {
      if (!okTypes.includes(e.type)) probs.push(`event type ${e.type}`);
      if (dayNumOf(e.effectiveDate) > TODAY_NUM) probs.push(`event ${e.id} dated in the future`);
      if (e.type === 'DOWNGRADE' && !(e.reason && e.reason.trim())) probs.push(`downgrade ${e.id} without a reason`);
    }
    return probs;
  };
  let broke = 0;
  let readBad = 0;
  for (let k = 0; k < steps; k++) {
    const name = maybe(0.02) ? 'bulk' : pick(names);
    const res = await actions[name]();
    counts[name] = counts[name] || {};
    counts[name][res.status] = (counts[name][res.status] || 0) + 1;
    if (res.status >= 500) {
      fivexx++;
      if (firstProblems.length < 6) firstProblems.push(`${name}: ${msg(res)}`);
    }
    if (k % 10 === 9) {
      const probs = await invariant();
      if (probs.length) {
        broke++;
        if (firstProblems.length < 6) firstProblems.push(`after ${name}: ${probs.slice(0, 2).join('; ')}`);
      }
      const sid = pick(sids);
      const e = await eligibilityOf(sid, st.id);
      const bd = await api('GET', `/v1/schools/${school.id}/grading-board?disciplineId=${st.id}`);
      if (e.res.status !== 200 || bd.status !== 200 || /NaN|undefined|Infinity/.test(JSON.stringify(e.res.body)) || (e.el?.hasNext && !NUMERIC_FIELDS.every((f) => Number.isFinite(e.el[f])))) {
        readBad++;
        if (firstProblems.length < 6) firstProblems.push(`read after ${name}: ${e.res.status}/${bd.status}`);
      }
    }
  }
  eq(fivexx, 0, `${steps} random actions (seed ${seed}): none answered 5xx ${firstProblems.join(' | ')}`);
  eq(broke, 0, `${steps} random actions (seed ${seed}): the data stayed consistent (checked every 10th action) ${firstProblems.join(' | ')}`);
  eq(readBad, 0, `${steps} random actions (seed ${seed}): eligibility and board reads never failed or showed NaN/undefined`);
  const promos = await su.promotionEvent.count({ where: { studentRank: { disciplineId: st.id }, type: { in: ['PROMOTION', 'STRIPE_AWARD', 'BULK_PROMOTION', 'BULK_STRIPE_AWARD'] } } });
  const downs = await su.promotionEvent.count({ where: { studentRank: { disciplineId: st.id }, type: 'DOWNGRADE' } });
  note(`Seed ${seed}: ${steps} actions; ${promos} promotions, ${downs} downgrades. Status counts: ${JSON.stringify(counts)}`);
}

// ===========================================================================
describeIfDb('Grading acceptance: the prototype\'s scenarios against the API', () => {
  beforeAll(async () => {
    // Thousands of requests from one address: the rate limits are tested
    // elsewhere (booking-throttle, auth), so they are off for this run only.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useValue({ throttlers: [{ ttl: 60_000, limit: 1 }], skipIf: () => true })
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await app.listen(0, '127.0.0.1');
    BASE = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    school = await su.school.create({ data: { id: randomUUID(), name: `Grading Acceptance ${new Date().toISOString()}`, ranksToggle: true } });
    const owner = userRow('Owner', 'Acceptance');
    await su.user.create({ data: owner });
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    ownerTok = jwtSvc.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] }, { expiresIn: '6h' });
  });

  afterAll(async () => {
    if (school) {
      const where = { schoolId: school.id };
      await su.promotionEvent.deleteMany({ where });
      await su.studentRankSkillStatus.deleteMany({ where });
      await su.studentRank.deleteMany({ where });
      await su.rankStripeTierRequiredSkill.deleteMany({ where: { skill: where } });
      await su.rankStripeTier.deleteMany({ where });
      await su.rank.deleteMany({ where });
      await su.skill.deleteMany({ where });
      await su.discipline.deleteMany({ where });
      await su.roleGrant.deleteMany({ where });
      for (let attempt = 0; ; attempt++) {
        await su.notification.deleteMany({ where: { userId: { in: userIds } } });
        try {
          await su.user.deleteMany({ where: { id: { in: userIds } } });
          break;
        } catch (err) {
          if (attempt >= 20) throw err;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      await su.school.delete({ where: { id: school.id } });
    }
    await su.$disconnect();
    await app?.close();
  });

  /** Runs one harness suite and fails with every failed check it recorded. */
  const run = (name: string, fn: () => Promise<void>, timeoutMs: number) =>
    it(
      name,
      async () => {
        const before = fails.length;
        await suite(name, fn);
        // eslint-disable-next-line no-console
        if (FULL) for (const n of notes.filter((x) => x.suite === name)) console.log(`[${name}] ${n.text}`);
        expect(perSuite[name].tested).toBeGreaterThan(0);
        expect(fails.slice(before).map((f) => `${f.family}: ${f.label} :: ${f.detail.slice(0, 300)}`)).toEqual([]);
      },
      timeoutMs,
    );

  run('2 · ladders: the three IBJJF templates', suiteLadders, 120_000);
  run('3 · eligibility and grading on the template stripes', suiteEligibility, FULL ? 3_600_000 : 300_000);
  it('4 · sets up the rules style', setupRulesStyle, 60_000);
  run('4 · grade and downgrade rules', suiteGradeRules, 120_000);
  run('5 · student panel data: skills, classes, days', suiteStudentPanel, 120_000);
  run('6 · Grading Board with 600 students, bulk promote, drags', () => suiteBoard(SEED), FULL ? 900_000 : 300_000);
  run('10 · hostile and awkward text is stored exactly', suiteHostile, 120_000);
  for (let k = 0; k < RANDOM_RUNS; k++) {
    run(`11 · random actions (seed ${SEED + k}): no 5xx, data stays consistent`, () => suiteRandom(SEED + k, RANDOM_STEPS), FULL ? 1_800_000 : 300_000);
  }
});
