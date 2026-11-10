// Round 7, D check 4: GET /bookings/me order and paging (#533, Decision 450
// item 2). One member with 300+ bookings over two Schools: upcoming, past
// (class times moved back in the database: "after the class"), cancelled, ties
// on the start time, and classes the member can no longer read (their access
// at School B revoked in the database: "removed from the School").
// Checks: walking every page (several page sizes) never skips or repeats; the
// order is upcoming soonest-first, past newest-first, then unreadable; a class
// that ends while paging doesn't move; an old id cursor is refused (400).
import { DateTime } from 'luxon';
import { call, must, db, rec, expect, saveOut, makeSchool, makeMember, plan, signIn } from './lib.mjs';

const A = 'bookings';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N_A = Number(process.env.N_A || 260), N_B = Number(process.env.N_B || 50);

const sa = await makeSchool('notready', 'D7 Bookings A');
const sb = await makeSchool('notready', 'D7 Bookings B');
for (const s of [sa, sb]) {
  const sch = await db.school.findUnique({ where: { id: s.id } });
  const wKey = Object.keys(sch).find((k) => /waiver/i.test(k) && /book|checkin|required/i.test(k) && typeof sch[k] === 'boolean');
  if (wKey) await db.school.update({ where: { id: s.id }, data: { [wKey]: false } });
}
const m = await makeMember(sa, 'Bea', 'Busy');
await must('join B', 'POST', `/schools/${sb.id}/join`, m.tok, { branchId: sb.branch.id });
for (const s of [sa, sb]) {
  const p = await plan(s, { type: 'WEEKLY_PASS', title: 'Year', price: 1000, expiryDurationDays: 365 });
  await must('sell', 'POST', `/schools/${s.id}/students/${m.id}/memberships/sell`, s.owner.tok, { membershipPlanId: p.id, paymentMethod: 'CASH' });
}
await signIn(m);

const base = Date.now() + 3 * 86400e3;
let bookErrors = [];
async function bookMany(s, n, tag) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    // Every 5th class shares its start time with the one before it (ties on the start time).
    const slot = i % 5 === 4 ? i - 1 : i;
    const start = new Date(base + slot * 3600e3 + (s === sb ? 1800e3 : 0));
    const cls = await must('class', 'POST', `/schools/${s.id}/classes`, s.owner.tok, { branchId: s.branch.id, title: `${tag} ${i}`, activities: ['BJJ'], startDate: start.toISOString(), endDate: new Date(start.getTime() + 3600e3).toISOString(), membershipInclusion: true, capacity: 30 });
    const b = await call('POST', `/classes/${cls.id}/book`, m.tok, {});
    if (b.status >= 300) { bookErrors.push(`${b.status} ${b.body?.error?.message}`); continue; }
    ids.push({ booking: b.body.id, cls: cls.id, i });
  }
  return ids;
}
const A_ = await bookMany(sa, N_A, 'A');
const B_ = await bookMany(sb, N_B, 'B');
rec(A, 'setup', 'NOTE', { bookedA: A_.length, bookedB: B_.length, errors: [...new Set(bookErrors)].slice(0, 5), errorCount: bookErrors.length });

// Cancel every 9th at A (a cancelled booking still lists).
let cancelled = 0;
for (const x of A_.filter((x) => x.i % 9 === 0)) { const r = await call('PATCH', `/bookings/${x.booking}/cancel`, m.tok, {}); if (r.status < 300) cancelled++; }
// "After the class": 60% of A's classes move into the past (kept in the same
// relative order, ties kept), keeping the booking as it is.
const now = Date.now();
for (const x of A_.filter((x) => x.i % 5 !== 0 || x.i % 2 === 0).slice(0, Math.floor(A_.length * 0.6))) {
  const cls = await db.class.findUnique({ where: { id: x.cls } });
  const back = 30 * 86400e3;
  await db.class.update({ where: { id: x.cls }, data: { startDate: new Date(cls.startDate.getTime() - back - 10 * 86400e3), endDate: new Date(cls.endDate.getTime() - back - 10 * 86400e3) } });
}
// One class in progress now, ending in 40 seconds (it must not move while paging).
const ending = A_.find((x) => x.i === 1);
await db.class.update({ where: { id: ending.cls }, data: { startDate: new Date(now - 3600e3), endDate: new Date(now + 40e3) } });
// School B removes the member: B's classes are now unreadable to them.
await db.roleGrant.updateMany({ where: { schoolId: sb.id, userId: m.id, revokedAt: null }, data: { revokedAt: new Date() } });
await signIn(m);
rec(A, 'shape', 'NOTE', { cancelled, total: await db.booking.count({ where: { studentId: m.id } }) });

// The truth, from the database.
const all = await db.booking.findMany({ where: { studentId: m.id }, include: { class: { select: { startDate: true, endDate: true, schoolId: true } } } });
function expectedOrder(at) {
  const readable = (b) => b.class.schoolId === sa.id;
  const up = all.filter((b) => readable(b) && b.class.endDate > at).sort((a, b) => a.class.startDate - b.class.startDate || (a.id < b.id ? -1 : 1));
  const past = all.filter((b) => readable(b) && b.class.endDate <= at).sort((a, b) => b.class.startDate - a.class.startDate || (a.id < b.id ? 1 : -1));
  const gone = all.filter((b) => !readable(b)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return [...up, ...past, ...gone].map((b) => b.id);
}
async function walk(limit, pauseAfterPage = -1, pauseMs = 0) {
  const seen = []; let cursor = null, pages = 0, firstAt = null, err = null;
  do {
    let r = await call('GET', `/bookings/me?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, m.tok);
    if (r.status === 401) { await signIn(m); r = await call('GET', `/bookings/me?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, m.tok); }
    if (r.status !== 200) { err = { status: r.status, body: r.body }; break; }
    if (pages === 0) firstAt = new Date();
    seen.push(...r.body.items.map((b) => b.id));
    cursor = r.body.nextCursor; pages++;
    if (pages === pauseAfterPage) await sleep(pauseMs);
  } while (cursor && pages < 500);
  return { seen, pages, firstAt, err };
}
for (const limit of [7, 20, 50, 100]) {
  const t0 = new Date();
  const w = await walk(limit);
  const want = expectedOrder(t0);
  const dupes = w.seen.length - new Set(w.seen).size;
  const missing = want.filter((id) => !w.seen.includes(id)).length;
  const firstBad = w.seen.findIndex((id, i) => id !== want[i]);
  expect(A, `P1 limit ${limit}: every booking once, in order (up asc, past desc, unreadable last)`, !w.err && dupes === 0 && missing === 0 && w.seen.length === want.length && firstBad === -1, { err: w.err, pages: w.pages, got: w.seen.length, want: want.length, dupes, missing, firstBad, around: firstBad >= 0 ? { got: w.seen.slice(firstBad, firstBad + 3), want: want.slice(firstBad, firstBad + 3) } : null });
}
// A class ending while the member pages: page 1 now, then wait until it has ended, then the rest.
{
  const t0 = new Date();
  const w = await walk(10, 1, 45000);
  const want = expectedOrder(t0);
  const dupes = w.seen.length - new Set(w.seen).size;
  const pos = w.seen.indexOf(ending.booking), wantPos = want.indexOf(ending.booking);
  const ended = (await db.class.findUnique({ where: { id: ending.cls } })).endDate < new Date();
  expect(A, 'P2 a class ending mid-paging keeps its place (shown once, in the upcoming part)', !w.err && ended && dupes === 0 && pos === wantPos && w.seen.length === want.length, { ended, pos, wantPos, dupes, got: w.seen.length, want: want.length, err: w.err });
  // A fresh first page now puts it in the past part.
  const w2 = await walk(100);
  const want2 = expectedOrder(new Date());
  expect(A, 'P2b read afresh after it ended: it is in the past part', w2.seen.indexOf(ending.booking) === want2.indexOf(ending.booking), { pos: w2.seen.indexOf(ending.booking), want: want2.indexOf(ending.booking) });
}
// Old cursors.
{
  await signIn(m);
  const oldId = Buffer.from(JSON.stringify({ id: A_[3].booking })).toString('base64url');
  const tries = { rawId: A_[3].booking, oldIdCursor: oldId, junk: 'abc', badPart: Buffer.from(JSON.stringify({ p: 'later', at: new Date().toISOString(), s: new Date().toISOString(), id: A_[3].booking })).toString('base64url'), upNoStart: Buffer.from(JSON.stringify({ p: 'up', at: new Date().toISOString(), s: null, id: A_[3].booking })).toString('base64url') };
  const res = {};
  for (const [k, c] of Object.entries(tries)) { const r = await call('GET', `/bookings/me?cursor=${encodeURIComponent(c)}`, m.tok); res[k] = r.status; }
  expect(A, 'P3 an old id cursor (and other unreadable cursors) -> 400', Object.values(res).every((x) => x === 400), res);
}
// The items carry class names for readable classes and nulls for unreadable ones.
{
  const w = await call('GET', `/bookings/me?limit=100&cursor=${encodeURIComponent(Buffer.from(JSON.stringify({ p: 'gone', at: new Date().toISOString(), s: null, id: '00000000-0000-0000-0000-000000000000' })).toString('base64url'))}`, m.tok);
  const items = w.body?.items ?? [];
  expect(A, 'P4 the unreadable part: B\'s bookings, no class name/time/School name leaked', w.status === 200 && items.length === B_.length && items.every((b) => b.classTitle === null && b.classStartsAt === null && b.schoolName === null), { status: w.status, n: items.length, sample: items[0] && { classTitle: items[0].classTitle, schoolName: items[0].schoolName } });
}
saveOut('bookings-out.json');
await db.$disconnect();
process.exit(0);
