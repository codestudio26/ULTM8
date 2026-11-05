// Round 5 NG, part 2: walk-ins, visit passes, guests, Guardians, refunds as credit,
// the School cancelling a class, Kid Mode — repeated at once.
//   ONLY=Q1,Q2 ...
import fs from 'fs';
import { db, call, checks, codes, tokenRca } from '../../round4/common.mjs';
import { createHmac } from 'crypto';
const c = JSON.parse(fs.readFileSync(new URL('./ng-cast.json', import.meta.url)));
const { ok, save } = checks('ng-race2');
const N = Number(process.env.N || 10);
const run = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
const S = c.schoolId;
const burst = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const log = (...a) => console.log('   ', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USED = new URL('./used.json', import.meta.url);
const used = new Set((() => { try { return JSON.parse(fs.readFileSync(USED)); } catch { return []; } })());
const take = (kind, branch) => { const x = c.students.find((s, i) => i >= 25 && i < 300 && s.kind === kind && !used.has(s.id) && (!branch || s.branch === branch)); used.add(x.id); fs.writeFileSync(USED, JSON.stringify([...used])); return x; };
const linkFor = (attendeeId) => createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(`guest-waiver-link:v1:${attendeeId}`).digest('base64url');

// Q1 approving the duplicate walk-in sign-ups (left by R10) at once, by two staff
if (run('Q1')) {
  const rows = await db.signUp.findMany({ where: { schoolId: S, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
  log('pending sign-ups', rows.length, [...new Set(rows.map((r) => r.email))]);
  const dupes = rows.filter((r) => r.email === rows[0]?.email);
  if (dupes.length >= 2) {
    const rs = await Promise.all([
      ...Array.from({ length: 3 }, () => call('q1:approve-a', 'POST', `/schools/${S}/sign-ups/${dupes[0].id}/approve`, c.owner.tok, {})),
      ...Array.from({ length: 3 }, () => call('q1:approve-b', 'POST', `/schools/${S}/sign-ups/${dupes[1].id}/approve`, c.staff[0].tok, {})),
    ]);
    const users = await db.user.count({ where: { email: dupes[0].email } });
    const after = await db.signUp.findMany({ where: { email: dupes[0].email }, select: { status: true } });
    const vp = await db.membership.count({ where: { user: { email: dupes[0].email } } }).catch(() => null);
    ok('Q1 two staff approve two copies of the same walk-in at once: one account, no server error', users === 1 && rs.every((r) => r.status < 500), `codes ${JSON.stringify(rs.map((r) => r.status))}; ${users} accounts; sign-ups ${JSON.stringify(after.map((a) => a.status))}; ${JSON.stringify(rs.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
    fs.writeFileSync(new URL('./q1.json', import.meta.url), JSON.stringify({ rs, after }, null, 1));
  }
}

// Q2 visit pass ×N (owner)
if (run('Q2')) {
  const vs = take('none');
  const vp = await burst(N, () => call('q2:visit-pass', 'POST', `/schools/${S}/students/${vs.id}/visit-passes`, c.staff[vs.branch === c.branches.island ? 0 : 1].tok, {}));
  const nvp = await db.membership.count({ where: { studentId: vs.id, membershipPlan: { type: 'VISIT_PASS' } } });
  ok('Q2 a visit pass given 10× at once by Branch Staff: one pass', nvp === 1, `codes ${JSON.stringify(codes(vp))}; ${nvp}; ${JSON.stringify(vp.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
}

// Q3 one guest link forwarded on WhatsApp, two different people sign at once
if (run('Q3')) {
  const s = take('sub', c.branches.island);
  await call('q3:gift', 'POST', `/schools/${S}/students/${s.id}/memberships/gift`, c.owner.tok, { membershipPlanId: c.plans.friend });
  const p = (await call('q3:passes', 'GET', `/schools/${S}/friend-passes/me`, s.tok)).body;
  const pid = (p?.items ?? p ?? [])[0]?.membershipId;
  const b = await call('q3:book', 'POST', `/classes/${c.classes.future[4]}/book`, s.tok, { attendeeMembershipIds: [pid] });
  const a = await db.bookingAttendee.findFirst({ where: { bookingId: b.body?.id } });
  const t = linkFor(a.id);
  const page = await call('q3:page', 'GET', `/guest-waiver-links/${t}`, null);
  const w = page.body.waivers.map((x) => ({ waiverId: x.id, version: x.version }));
  const two = await Promise.all(['Ngozi Okafor', 'Abubakar Bello', 'Ìyábọ̀ Àjàyí'].map((nm) => call('q3:sign', 'POST', `/guest-waiver-links/${t}/sign`, null, { guestFullName: nm, guestDateOfBirth: '1995-05-05', signerFullName: nm, signatureText: nm, waivers: w })));
  const names = await db.guestWaiverSignature.findMany({ where: { bookingAttendeeId: a.id }, select: { guestFullName: true } });
  ok('Q3 one guest link, three different people sign at once: one guest recorded, the others told', names.length === 1, `codes ${two.map((r) => r.status)}; ${JSON.stringify(names)}`);
  // a minor guest whose parent signs; the same name as signer is refused
  const s2 = take('sub', c.branches.island);
  await call('q3:gift2', 'POST', `/schools/${S}/students/${s2.id}/memberships/gift`, c.owner.tok, { membershipPlanId: c.plans.friend });
  const p2 = (await call('q3:passes2', 'GET', `/schools/${S}/friend-passes/me`, s2.tok)).body;
  const b2 = await call('q3:book2', 'POST', `/classes/${c.classes.future[4]}/book`, s2.tok, { attendeeMembershipIds: [(p2?.items ?? p2)[0].membershipId] });
  const a2 = await db.bookingAttendee.findFirst({ where: { bookingId: b2.body?.id } });
  const t2 = linkFor(a2.id);
  const kidSelf = await call('q3:kid-self', 'POST', `/guest-waiver-links/${t2}/sign`, null, { guestFullName: 'Chidera Obi', guestDateOfBirth: '2014-03-01', signerFullName: 'chidera obi ', signatureText: 'C', waivers: w });
  const kidMum = await call('q3:kid-mum', 'POST', `/guest-waiver-links/${t2}/sign`, null, { guestFullName: 'Chidera Obi', guestDateOfBirth: '2014-03-01', signerFullName: 'Ọlábísí Obi', signatureText: 'Ọ. Obi', waivers: w });
  const leap = await call('q3:leap-2023', 'GET', `/guest-waiver-links/${t2}`, null);
  ok('Q3b a child guest: refused when signing for themselves, accepted with the parent', kidSelf.status === 400 && kidMum.status < 300, `${kidSelf.status} ${JSON.stringify(kidSelf.body).slice(0, 120)}; ${kidMum.status}; page after ${leap.status}`);
}

// Q4 divorced parents both book their child for the same class at once, and both cancel at once
if (run('Q4')) {
  const kid = c.special.divorcedKid;
  c.guardians.mum.tok = tokenRca(c.guardians.mum, []); c.guardians.dad.tok = tokenRca(c.guardians.dad, []);
  const cls = c.classes.future.find((_, i) => (i % 2 === 0 ? c.branches.island : c.branches.ikeja) === kid.branch);
  const rs = await Promise.all([...Array.from({ length: 5 }, () => call('q4:mum', 'POST', `/classes/${cls}/book`, c.guardians.mum.tok, { studentId: kid.id })), ...Array.from({ length: 5 }, () => call('q4:dad', 'POST', `/classes/${cls}/book`, c.guardians.dad.tok, { studentId: kid.id }))]);
  const bk = await db.booking.findMany({ where: { studentId: kid.id, classId: cls, status: 'UPCOMING' } });
  ok('Q4 both divorced parents book the child 5× each at once: one booking', bk.length === 1, `codes ${JSON.stringify(codes(rs))}; ${bk.length}; ${JSON.stringify(rs.find((r) => r.status >= 300)?.body)?.slice(0, 160)}`);
  if (bk[0]) {
    const cs = await Promise.all([...Array.from({ length: 5 }, () => call('q4:mum-cancel', 'PATCH', `/bookings/${bk[0].id}/cancel`, c.guardians.mum.tok, { studentId: kid.id })), ...Array.from({ length: 5 }, () => call('q4:dad-cancel', 'PATCH', `/bookings/${bk[0].id}/cancel`, c.guardians.dad.tok, { studentId: kid.id }))]);
    const m = await db.membership.findFirst({ where: { studentId: kid.id, schoolId: S, membershipPlanId: c.plans.pack10 }, select: { classesRemaining: true } });
    ok('Q4b both parents cancel 5× each at once: cancelled once, credit back once', m.classesRemaining === 10, `codes ${JSON.stringify(codes(cs))}; credits ${m.classesRemaining}`);
  }
  // Okafor mum books all three siblings into a tiny 3-seat class at once, twice each (resent)
  const sibs = [c.special.kid7a, c.special.kid9b, c.special.kid11c];
  const tiny = c.classes.tiny3;
  const sb = await Promise.all(sibs.flatMap((k) => [0, 1].map(() => call('q4:sibs', 'POST', `/classes/${tiny}/book`, c.guardians.okafor.tok, { studentId: k.id }))));
  const nb = await db.booking.findMany({ where: { classId: tiny, status: 'UPCOMING' }, select: { studentId: true } });
  log('Q4c siblings into a 3-seat class (Island only):', JSON.stringify(codes(sb)), nb.length, 'booked', JSON.stringify(sb.filter((r) => r.status >= 300).map((r) => r.body?.error?.message)).slice(0, 300));
}

// Q5 refund as CREDIT ×N and a School-cancelled class ×N
if (run('Q5')) {
  const s = take('sub');
  const due = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
  const ch = await call('q5:charge', 'POST', `/schools/${S}/students/${s.id}/charges`, c.owner.tok, { description: 'Kit (dobok) ₦25,000', amount: 2500000, dueDate: due });
  await call('q5:pay', 'POST', `/schools/${S}/students/${s.id}/charge-payments`, c.owner.tok, { chargeId: ch.body.id, amount: 2500000, paymentMethod: 'CASH', sendReceipt: false });
  const tx = await db.transaction.findFirst({ where: { studentId: s.id, schoolId: S, membershipPlanId: null } });
  const rf = await burst(N, () => call('q5:refund-credit', 'POST', `/schools/${S}/charge-payments/${tx.id}/refund`, c.owner.tok, { amount: 500000, destination: 'CREDIT', notes: 'Wrong size, ₦5,000 back as credit' }));
  const sum = await db.chargeRefund.aggregate({ where: { transactionId: tx.id }, _sum: { amount: true }, _count: true });
  ok('Q5 ₦5,000 refund as credit sent 10× at once: once', sum._sum.amount === 500000, `codes ${JSON.stringify(codes(rf))}; ${sum._count} refunds totalling ₦${sum._sum.amount / 100}`);
  // School cancels a booked class, the owner's tap resent ×5
  const cls = c.classes.future[8];
  const ppl = Array.from({ length: 4 }, () => take('pack10', c.branches.island));
  for (const p of ppl) await call('q5:book', 'POST', `/classes/${cls}/book`, p.tok, {});
  const cc = await burst(5, () => call('q5:cancel-class', 'POST', `/classes/${cls}/cancel`, c.owner.tok, { reason: 'NEPA took the light — generator broken' }));
  const ms = await db.membership.findMany({ where: { studentId: { in: ppl.map((p) => p.id) }, membershipPlanId: c.plans.pack10 }, select: { classesRemaining: true } });
  const notes = await db.notification.count({ where: { userId: { in: ppl.map((p) => p.id) }, createdAt: { gte: new Date(Date.now() - 120e3) } } }).catch(() => null);
  ok('Q5b the School cancels a class, tap sent 5× at once: every credit back exactly once', ms.every((m) => m.classesRemaining === 10), `codes ${JSON.stringify(codes(cc))}; credits ${JSON.stringify(ms.map((m) => m.classesRemaining))}; notices ${notes}; ${JSON.stringify(cc.find((r) => r.status >= 300)?.body)?.slice(0, 160)}`);
}

// Q6 Kid Mode: token ×N, booking ×N from the child's device
if (run('Q6')) {
  const kid = c.special.kid9b;
  const kt = await burst(5, () => call('q6:kid-token', 'POST', `/guardians/me/minors/${kid.id}/kid-mode-token`, c.guardians.okafor.tok, {}));
  log('Q6 kid-mode-token ×5:', JSON.stringify(codes(kt)), JSON.stringify(kt[0].body).slice(0, 200));
  const tok = kt.find((r) => r.status < 300)?.body?.token ?? kt.find((r) => r.status < 300)?.body?.accessToken;
  if (tok) {
    const cls = c.classes.future.find((_, i) => (i % 2 === 0 ? c.branches.island : c.branches.ikeja) === kid.branch && i > 9);
    const bk = await burst(N, () => call('q6:kid-book', 'POST', `/classes/${cls}/book`, tok, {}));
    const n = await db.booking.count({ where: { studentId: kid.id, classId: cls, status: 'UPCOMING' } });
    ok('Q6 Kid Mode booking ×10 at once: one booking', n === 1, `codes ${JSON.stringify(codes(bk))}; ${n}; ${JSON.stringify(bk.find((r) => r.status >= 300)?.body)?.slice(0, 160)}`);
  }
}

save();
await db.$disconnect();
