// Round 5 NG: flaky Lagos mobile data — every write sent N times at once, and
// re-sent after a "timeout". Each section prints the codes and the DB truth.
//   ONLY=R1,R2  run some sections.  N (default 10) copies per burst.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca, checks, codes } from '../../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(new URL('./ng-cast.json', import.meta.url)));
const { ok, save } = checks('ng-race');
const N = Number(process.env.N || 10);
const run = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
const S = c.schoolId;
const burst = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const st = (k) => c.students[k];
const sp = c.special;
const log = (...a) => console.log('   ', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Students 30..: ordinary ones by kind, handed out once each.
const USED = new URL('./used.json', import.meta.url);
const used = new Set((() => { try { return JSON.parse(fs.readFileSync(USED)); } catch { return []; } })());
const take = (kind, branch) => { const x = c.students.find((s, i) => i >= 25 && i < 300 && s.kind === kind && !used.has(s.id) && (!branch || s.branch === branch)); used.add(x.id); fs.writeFileSync(USED, JSON.stringify([...used])); return x; };

// R1 booking ×N, same student same class
if (run('R1')) {
  const s = take('pack10', c.branches.island);
  const cls = c.classes.future[0];
  const rs = await burst(N, () => call('r1:book', 'POST', `/classes/${cls}/book`, s.tok, {}));
  const bk = await db.booking.findMany({ where: { studentId: s.id, classId: cls } });
  const m = await db.membership.findFirst({ where: { studentId: s.id, schoolId: S }, select: { classesRemaining: true } });
  ok('R1 booking sent 10× at once: one booking, one credit', bk.length === 1 && m.classesRemaining === 9, `codes ${JSON.stringify(codes(rs))}; ${bk.length} bookings, credits left ${m.classesRemaining}; sample non-2xx ${JSON.stringify(rs.find((r) => r.status >= 300)?.body)}`);
  // R1b cancel ×N
  const id = bk[0].id;
  const cs = await burst(N, () => call('r1:cancel', 'PATCH', `/bookings/${id}/cancel`, s.tok, {}));
  const m2 = await db.membership.findFirst({ where: { studentId: s.id, schoolId: S }, select: { classesRemaining: true } });
  const b2 = await db.booking.findUnique({ where: { id } });
  ok('R1b cancel sent 10× at once: cancelled once, credit back once', b2.status === 'CANCELLED' && m2.classesRemaining === 10, `codes ${JSON.stringify(codes(cs))}; status ${b2.status}, credits ${m2.classesRemaining}; sample ${JSON.stringify(cs.find((r) => r.status >= 300)?.body)}`);
  // R1c rebook after cancel, then a "late" retried cancel of the OLD booking id and a retried book
  const rb = await call('r1:rebook', 'POST', `/classes/${cls}/book`, s.tok, {});
  const late = await call('r1:old-cancel-retry', 'PATCH', `/bookings/${id}/cancel`, s.tok, {});
  const rb2 = await call('r1:rebook-retry', 'POST', `/classes/${cls}/book`, s.tok, {});
  const live = await db.booking.count({ where: { studentId: s.id, classId: cls, status: 'UPCOMING' } });
  const m3 = await db.membership.findFirst({ where: { studentId: s.id, schoolId: S }, select: { classesRemaining: true } });
  ok('R1c rebook, then the old cancel and the book retried: still one live booking, credits 9', live === 1 && m3.classesRemaining === 9, `rebook ${rb.status}, old-cancel retry ${late.status} ${JSON.stringify(late.body).slice(0, 160)}, rebook retry ${rb2.status} ${JSON.stringify(rb2.body).slice(0, 160)}; live ${live}, credits ${m3.classesRemaining}`);
  // R1d book and cancel racing each other, 5 each
  const s2 = take('pack10', c.branches.island);
  const first = await call('r1:book', 'POST', `/classes/${c.classes.future[2]}/book`, s2.tok, {});
  const mix = await Promise.all([...Array.from({ length: 5 }, () => call('r1d:book', 'POST', `/classes/${c.classes.future[2]}/book`, s2.tok, {})), ...Array.from({ length: 5 }, () => call('r1d:cancel', 'PATCH', `/bookings/${first.body?.id}/cancel`, s2.tok, {}))]);
  const liveB = await db.booking.findMany({ where: { studentId: s2.id, classId: c.classes.future[2] }, select: { status: true } });
  const m4 = await db.membership.findFirst({ where: { studentId: s2.id, schoolId: S }, select: { classesRemaining: true } });
  const nLive = liveB.filter((b) => b.status === 'UPCOMING').length;
  ok('R1d book×5 and cancel×5 racing: credits match live bookings', m4.classesRemaining === 10 - nLive && nLive <= 1, `codes ${JSON.stringify(codes(mix))}; bookings ${JSON.stringify(liveB.map((b) => b.status))}, credits ${m4.classesRemaining}`);
}

// R2 1-seat class: 10 different people at once, then waitlist ×N, claim ×N
if (run('R2')) {
  const ppl = Array.from({ length: 10 }, () => take('sub', c.branches.island));
  const rs = await Promise.all(ppl.map((p) => call('r2:book-1seat', 'POST', `/classes/${c.classes.tiny1}/book`, p.tok, {})));
  const n = await db.booking.count({ where: { classId: c.classes.tiny1, status: 'UPCOMING' } });
  ok('R2 a 1-seat class, 10 people at once: exactly 1 seat taken', n === 1, `codes ${JSON.stringify(codes(rs))}`);
  const loser = ppl[rs.findIndex((r) => r.status >= 300)];
  const wl = await burst(N, () => call('r2:waitlist', 'POST', `/classes/${c.classes.tiny1}/waitlist`, loser.tok, {}));
  const nW = await db.waitlistEntry.count({ where: { classId: c.classes.tiny1, studentId: loser.id } });
  ok('R2b waitlist join ×10: one entry', nW === 1, `codes ${JSON.stringify(codes(wl))}; ${nW} entries; ${JSON.stringify(wl.find((r) => r.status >= 300)?.body)}`);
  // Free the seat: winner cancels, the loser gets an offer, then claims ×N
  const winner = ppl[rs.findIndex((r) => r.status < 300)];
  const wb = await db.booking.findFirst({ where: { classId: c.classes.tiny1, studentId: winner.id } });
  await call('r2:cancel', 'PATCH', `/bookings/${wb.id}/cancel`, winner.tok, {});
  let entry;
  for (let i = 0; i < 20; i++) { entry = await db.waitlistEntry.findFirst({ where: { classId: c.classes.tiny1, studentId: loser.id } }); if (entry?.status && entry.status !== 'WAITING') break; await sleep(500); }
  const cl = await burst(N, () => call('r2:claim', 'POST', `/waitlist/${entry.id}/claim`, loser.tok, {}));
  const nb = await db.booking.count({ where: { classId: c.classes.tiny1, studentId: loser.id, status: 'UPCOMING' } });
  const total = await db.booking.count({ where: { classId: c.classes.tiny1, status: 'UPCOMING' } });
  ok('R2c seat-offer claim ×10: one booking, class still 1/1', nb === 1 && total === 1, `entry status ${entry.status}; codes ${JSON.stringify(codes(cl))}; loser bookings ${nb}, class ${total}; ${JSON.stringify(cl.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
}

// R3 Friend Pass gift ×N; then booking with guests ×N; guest waiver sign ×N; guest check-in ×N
if (run('R3')) {
  const s = take('sub', c.branches.island);
  const gf = await burst(N, () => call('r3:gift', 'POST', `/schools/${S}/students/${s.id}/memberships/gift`, c.owner.tok, { membershipPlanId: c.plans.friend }));
  const passes = await db.membership.count({ where: { studentId: s.id, membershipPlanId: c.plans.friend } });
  ok('R3 Friend Pass gift sent 10× at once: one pass', passes === 1, `codes ${JSON.stringify(codes(gf))}; ${passes} passes; ${JSON.stringify(gf.find((r) => r.status >= 300)?.body)}`);
  // A second, deliberate pass after the minute (two friends coming): give it via the DB-free route after waiting? Use the co-owner.
  const gf2 = await call('r3:gift-second-friend', 'POST', `/schools/${S}/students/${s.id}/memberships/gift`, c.coOwner.tok, { membershipPlanId: c.plans.friend });
  log('second friend pass by co-owner within the minute:', gf2.status, JSON.stringify(gf2.body).slice(0, 200));
  const myPasses = await call('r3:passes', 'GET', `/schools/${S}/friend-passes/me`, s.tok);
  const passIds = (myPasses.body?.items ?? myPasses.body ?? []).map((p) => p.membershipId);
  const cls = c.classes.future[4];
  const bk = await burst(N, () => call('r3:book-guest', 'POST', `/classes/${cls}/book`, s.tok, { attendeeMembershipIds: passIds.slice(0, 1) }));
  const bookings = await db.booking.findMany({ where: { studentId: s.id, classId: cls }, include: { attendees: true } });
  const pass = await db.membership.findFirst({ where: { id: passIds[0] } });
  ok('R3b booking with a guest sent 10× at once: one booking, one guest seat, pass used once', bookings.length === 1 && bookings[0]?.attendees?.filter((a) => a.membershipId === passIds[0]).length === 1, `codes ${JSON.stringify(codes(bk))}; ${bookings.length} bookings, attendees ${JSON.stringify(bookings.map((b) => b.attendees.length))}; pass classesRemaining ${pass?.classesRemaining}; ${JSON.stringify(bk.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  const booking = bookings[0];
  const guests = await call('r3:guests', 'GET', `/bookings/${booking.id}/guests`, s.tok);
  const att = booking.attendees.find((a) => a.membershipId === passIds[0]);
  const { createHmac } = await import('crypto');
  const token = createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(`guest-waiver-link:v1:${att.id}`).digest('base64url');
  log('guests', guests.status, JSON.stringify(guests.body).slice(0, 300));
  const page = await call('r3:guest-page', 'GET', `/guest-waiver-links/${token}`, null);
  const body = { guestFullName: 'Ọlábísí Adébáyọ̀', guestDateOfBirth: '1999-02-28', signerFullName: 'Ọlábísí Adébáyọ̀', signatureText: 'Ọlábísí A.', waivers: (page.body?.waivers ?? []).filter((w) => !w.signed).map((w) => ({ waiverId: w.id, version: w.version })) };
  const sg = await burst(N, () => call('r3:guest-sign', 'POST', `/guest-waiver-links/${token}/sign`, null, body));
  const sigs = await db.guestWaiverSignature.count({ where: { bookingAttendeeId: att.id } });
  ok('R3c guest waiver signed 10× at once on a shared link: one signature per waiver', sigs === body.waivers.length && sigs > 0, `page ${page.status}; codes ${JSON.stringify(codes(sg))}; ${sigs} signatures for ${body.waivers.length} waivers; ${JSON.stringify(sg.find((r) => r.status >= 300 && r.status !== 409)?.body)?.slice(0, 200)}`);
  // Two different friends opening the same shared link (link forwarded on WhatsApp) at once
  const s3 = take('sub', c.branches.island);
  await call('r3:gift3', 'POST', `/schools/${S}/students/${s3.id}/memberships/gift`, c.owner.tok, { membershipPlanId: c.plans.friend });
  const p3 = (await call('r3:passes3', 'GET', `/schools/${S}/friend-passes/me`, s3.tok)).body;
  const pid3 = (p3?.items ?? p3 ?? [])[0]?.membershipId;
  const b3 = await call('r3:book3', 'POST', `/classes/${cls}/book`, s3.tok, { attendeeMembershipIds: [pid3] });
  const a3 = await db.bookingAttendee.findFirst({ where: { bookingId: b3.body?.id, membershipId: pid3 } });
  if (a3) {
    const t3 = createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(`guest-waiver-link:v1:${a3.id}`).digest('base64url');
    const w3 = (await call('r3:page3', 'GET', `/guest-waiver-links/${t3}`, null)).body?.waivers?.map((w) => ({ waiverId: w.id, version: w.version }));
    const two = await Promise.all(['Ngozi Okafor', 'Abubakar Bello'].map((nm) => call('r3:two-friends', 'POST', `/guest-waiver-links/${t3}/sign`, null, { guestFullName: nm, guestDateOfBirth: '1995-05-05', signerFullName: nm, signatureText: nm, waivers: w3 })));
    const names = await db.guestWaiverSignature.findMany({ where: { bookingAttendeeId: a3.id }, select: { guestFullName: true } });
    ok('R3d one guest link signed by two different people at once: one name kept', new Set(names.map((x) => x.guestFullName)).size === 1, `codes ${two.map((r) => r.status)}; names ${JSON.stringify(names)}`);
  }
  // Guest check-in ×N by staff (class tomorrow: expect CHECK_IN_NOT_OPEN, so use a Now class)
  const s4 = take('sub', c.branches.island);
  await call('r3:gift4', 'POST', `/schools/${S}/students/${s4.id}/memberships/gift`, c.owner.tok, { membershipPlanId: c.plans.friend });
  const p4 = (await call('r3:passes4', 'GET', `/schools/${S}/friend-passes/me`, s4.tok)).body;
  const pid4 = (p4?.items ?? p4 ?? [])[0]?.membershipId;
  const b4 = await call('r3:book4', 'POST', `/classes/${c.classes.now[0]}/book`, s4.tok, { attendeeMembershipIds: [pid4] });
  const a4 = await db.bookingAttendee.findFirst({ where: { bookingId: b4.body?.id, membershipId: pid4 } });
  if (a4) {
    const gc = await burst(N, () => call('r3:guest-checkin', 'POST', `/bookings/${b4.body.id}/guests/${a4.id}/check-in`, c.staff[0].tok, {}));
    const a4b = await db.bookingAttendee.findUnique({ where: { id: a4.id } });
    ok('R3e guest check-in ×10: checked in once', !!a4b.checkedInAt && gc.filter((r) => r.status < 300).length >= 1, `codes ${JSON.stringify(codes(gc))}; checkedInAt ${a4b.checkedInAt?.toISOString()}; ${JSON.stringify(gc.find((r) => r.status >= 300)?.body)?.slice(0, 160)}`);
  } else log('R3e skipped: book4', b4.status, JSON.stringify(b4.body).slice(0, 200));
}

// R4 desk sale (sell) ×N, Record a payment ×N, both routes at once, and a retry after 65 s is NOT done here
if (run('R4')) {
  const s = take('none');
  const rs = await burst(N, (i) => call('r4:sell', 'POST', `/schools/${S}/students/${s.id}/memberships/sell`, c.owner.tok, { membershipPlanId: c.plans.pack5, paymentMethod: 'CASH' }));
  const tx = await db.transaction.count({ where: { studentId: s.id, membershipPlanId: c.plans.pack5 } });
  const mm = await db.membership.count({ where: { studentId: s.id, membershipPlanId: c.plans.pack5 } });
  ok('R4 desk sale ×10 from the Student page: one payment, one pack', tx === 1 && mm === 1, `codes ${JSON.stringify(codes(rs))}; ${tx} tx, ${mm} packs; ${JSON.stringify(rs.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  const s2 = take('none');
  const mixed = await Promise.all([
    ...Array.from({ length: 5 }, () => call('r4b:sell', 'POST', `/schools/${S}/students/${s2.id}/memberships/sell`, c.owner.tok, { membershipPlanId: c.plans.pack10, paymentMethod: 'CASH' })),
    ...Array.from({ length: 5 }, () => call('r4b:desk', 'POST', `/schools/${S}/desk-payments`, c.coOwner.tok, { studentId: s2.id, membershipPlanId: c.plans.pack10, paymentMethod: 'CASH' })),
  ]);
  const tx2 = await db.transaction.count({ where: { studentId: s2.id, membershipPlanId: c.plans.pack10 } });
  ok('R4b the owner (Student page) and co-owner (Record a payment) both record the same cash sale 5× at once: one sale', tx2 === 1, `codes ${JSON.stringify(codes(mixed))}; ${tx2} tx`);
  // R4c same student, two DIFFERENT pack plans at once (owner taps wrong plan then right plan)
  const s3 = take('none');
  const two = await Promise.all([call('r4c', 'POST', `/schools/${S}/desk-payments`, c.owner.tok, { studentId: s3.id, membershipPlanId: c.plans.pack5, paymentMethod: 'CASH' }), call('r4c', 'POST', `/schools/${S}/desk-payments`, c.owner.tok, { studentId: s3.id, membershipPlanId: c.plans.pack10, paymentMethod: 'CASH' })]);
  log('R4c two different packs at once:', two.map((r) => r.status));
  // R4d week pass ×N: one live Weekly Pass rule
  const s4 = take('none');
  const wk = await burst(N, () => call('r4d:week', 'POST', `/schools/${S}/desk-payments`, c.owner.tok, { studentId: s4.id, membershipPlanId: c.plans.week, paymentMethod: 'CARD_TERMINAL' }));
  const nwk = await db.membership.count({ where: { studentId: s4.id, membershipPlanId: c.plans.week } });
  ok('R4d week pass at the card terminal ×10: one', nwk === 1, `codes ${JSON.stringify(codes(wk))}; ${nwk}`);
  // R4e trial ×N via desk
  const s5 = take('none');
  const tr = await burst(N, () => call('r4e:trial', 'POST', `/schools/${S}/desk-payments`, c.owner.tok, { studentId: s5.id, membershipPlanId: c.plans.trial, paymentMethod: 'CASH' }));
  const ntr = await db.membership.count({ where: { studentId: s5.id, membershipPlanId: c.plans.trial } });
  ok('R4e free trial at the desk ×10: one trial', ntr === 1, `codes ${JSON.stringify(codes(tr))}; ${ntr}; ${JSON.stringify(tr.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  // R4f Pix in Nigeria
  const s6 = take('none');
  const pix = await call('r4f:pix', 'POST', `/schools/${S}/desk-payments`, c.owner.tok, { studentId: s6.id, membershipPlanId: c.plans.pack5, paymentMethod: 'PIX' });
  const bt = await call('r4f:bank', 'POST', `/schools/${S}/desk-payments`, c.owner.tok, { studentId: take('none').id, membershipPlanId: c.plans.pack5, paymentMethod: 'BANK_TRANSFER' });
  log('R4f Pix in Nigeria:', pix.status, JSON.stringify(pix.body).slice(0, 200), '| bank transfer:', bt.status);
  fs.writeFileSync(new URL('./r4-pix.json', import.meta.url), JSON.stringify({ pix, bt }, null, 1));
}

// R5 student cash order ×N (Decision 339 item 9) and the owner confirming it ×N
if (run('R5')) {
  const s = take('none');
  const rs = await burst(N, () => call('r5:cash-order', 'POST', `/membership-plans/${c.plans.pack5}/purchase`, s.tok, {}));
  const pend = await db.transaction.findMany({ where: { studentId: s.id, membershipPlanId: c.plans.pack5 } });
  ok('R5 the student taps "Pay cash at the desk" 10×: one Pending row', pend.length === 1, `codes ${JSON.stringify(codes(rs))}; ${pend.length} rows ${JSON.stringify(pend.map((p) => p.status))}; ${JSON.stringify(rs[0].body).slice(0, 200)}`);
  if (pend[0]) {
    const cf = await burst(N, () => call('r5:confirm', 'PATCH', `/transactions/${pend[0].id}/confirm`, c.owner.tok, {}));
    const mm = await db.membership.count({ where: { studentId: s.id, membershipPlanId: c.plans.pack5 } });
    ok('R5b the owner confirms the cash payment 10×: one membership', mm === 1, `codes ${JSON.stringify(codes(cf))}; ${mm} memberships; ${JSON.stringify(cf.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
    // Confirm and cancel at once (owner and co-owner disagree)
    const s2 = take('none');
    const o2 = await call('r5c:order', 'POST', `/membership-plans/${c.plans.pack10}/purchase`, s2.tok, {});
    const t2 = await db.transaction.findFirst({ where: { studentId: s2.id, membershipPlanId: c.plans.pack10 } });
    if (t2) {
      const both = await Promise.all([...Array.from({ length: 3 }, () => call('r5c:confirm', 'PATCH', `/transactions/${t2.id}/confirm`, c.owner.tok, {})), ...Array.from({ length: 3 }, () => call('r5c:cancel', 'PATCH', `/transactions/${t2.id}/cancel`, c.coOwner.tok, {}))]);
      const t2b = await db.transaction.findUnique({ where: { id: t2.id } });
      const m2 = await db.membership.count({ where: { studentId: s2.id, membershipPlanId: c.plans.pack10 } });
      ok('R5c confirm ×3 and cancel ×3 at once: consistent (Successful+1 membership, or Failed+0)', (t2b.status === 'SUCCESSFUL' && m2 === 1) || (t2b.status === 'FAILED' && m2 === 0), `codes ${JSON.stringify(both.map((r) => r.status))}; tx ${t2b.status}, memberships ${m2}`);
    } else log('R5c no order', o2.status, JSON.stringify(o2.body).slice(0, 200));
  }
}

// R6 waiver signing ×N (adult), Guardian for minor ×N, two Guardians (divorced parents) at once
if (run('R6')) {
  const s = take('sub');
  const body = { signerFullName: 'Ọlábísí Okonkwo', signatureText: 'Ọlábísí O.', waiverVersion: c.waiver.version };
  const rs = await burst(N, () => call('r6:sign', 'POST', `/waivers/${c.waiver.id}/sign`, s.tok, body));
  const n = await db.waiverSignature.count({ where: { waiverId: c.waiver.id, studentId: s.id } });
  ok('R6 adult waiver signed 10× at once: one signature', n === 1, `codes ${JSON.stringify(codes(rs))}; ${n}; ${JSON.stringify(rs.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  const kid = sp.divorcedKid;
  const both = await Promise.all([...Array.from({ length: 5 }, () => call('r6b:mum', 'POST', `/waivers/${c.waiver.id}/sign`, c.guardians.mum.tok, { ...body, signerFullName: 'Halima Ibrahim', studentId: kid.id })), ...Array.from({ length: 5 }, () => call('r6b:dad', 'POST', `/waivers/${c.waiver.id}/sign`, c.guardians.dad.tok, { ...body, signerFullName: 'Chinedu Eze', studentId: kid.id }))]);
  const nk = await db.waiverSignature.count({ where: { waiverId: c.waiver.id, studentId: kid.id } });
  ok('R6b both divorced parents sign the child\'s waiver 5× each at once: one signature', nk === 1, `codes ${JSON.stringify(codes(both))}; ${nk}`);
}

// R7 front-desk check-in ×N (staff portal and tablet), personal code ×N, student code ×N
if (run('R7')) {
  const s = take('sub', c.branches.island);
  const cls = c.classes.now[0];
  const rs = await burst(N, () => call('r7:desk', 'POST', `/schools/${S}/front-desk/check-ins`, c.staff[0].tok, { studentId: s.id, classIds: [cls] }));
  const att = await db.booking.count({ where: { studentId: s.id, classId: cls, checkInMethod: { not: null } } });
  const bk = await db.booking.count({ where: { studentId: s.id, classId: cls, status: { not: 'CANCELLED' } } });
  ok('R7 front desk check-in (book + check in) ×10 at once: one booking, one attendance', att === 1 && bk === 1, `codes ${JSON.stringify(codes(rs))}; ${att} attendance, ${bk} bookings; bodies ${JSON.stringify([...new Set(rs.map((r) => JSON.stringify(r.body).slice(0, 120)))]).slice(0, 500)}`);
  // tablet: personal code
  const s2 = take('pack10', c.branches.island);
  const code = await call('r7:issue', 'POST', `/schools/${S}/students/${s2.id}/check-in-code`, c.owner.tok, {});
  const codeX = await burst(5, () => call('r7:issue-x5', 'POST', `/schools/${S}/students/${s2.id}/check-in-code`, c.owner.tok, {}));
  const nCodes = await db.studentCheckInCode.count({ where: { studentId: s2.id, schoolId: S } });
  log('R7 issue code ×5:', JSON.stringify(codes(codeX)), nCodes, 'codes stored');
  const sess = await call('r7:tablet', 'POST', `/schools/${S}/front-desk/sessions`, c.staff[0].tok, { branchId: c.branches.island });
  const kt = sess.body?.sessionToken;
  const theCode = (await db.studentCheckInCode.findFirst({ where: { studentId: s2.id, schoolId: S } }))?.code ?? codeX.find((r) => r.status < 300)?.body?.code ?? code.body?.code;
  const lk = await burst(5, () => call('r7:code-lookup', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: theCode }));
  const lt = lk.find((r) => r.status < 300)?.body?.lookupToken;
  const ci = await burst(N, () => call('r7:kiosk-checkin', 'POST', '/front-desk/kiosk/check-ins', kt, { studentId: s2.id, lookupToken: lt, classIds: [cls] }));
  const att2 = await db.booking.count({ where: { studentId: s2.id, classId: cls, checkInMethod: { not: null } } });
  const m2 = await db.membership.findFirst({ where: { studentId: s2.id, schoolId: S, membershipPlanId: c.plans.pack10 } });
  ok('R7b tablet check-in by personal code ×10 at once: one attendance, one credit', att2 === 1 && m2.classesRemaining === 9, `tablet ${sess.status}; code ${theCode ? 'yes' : 'no'}; lookups ${JSON.stringify(codes(lk))}; codes ${JSON.stringify(codes(ci))}; ${att2} attendance; credits ${m2.classesRemaining}; ${JSON.stringify(ci[0].body).slice(0, 200)}`);
  // Student enters the class attendance code ×N (attendance/code)
  const s3 = take('pack10', c.branches.island);
  await call('r7c:book', 'POST', `/classes/${cls}/book`, s3.tok, {});
  const qr = await call('r7c:qr', 'GET', `/classes/${cls}/qr-token`, c.instructors[0].tok);
  const k = { attendanceCode: qr.body?.code };
  if (k?.attendanceCode) {
    const ac = await burst(N, () => call('r7c:code', 'POST', '/attendance/code', s3.tok, { classId: cls, code: k.attendanceCode }));
    const att3 = await db.booking.count({ where: { studentId: s3.id, classId: cls, checkInMethod: { not: null } } });
    ok('R7c student types the class code 10× at once: one attendance', att3 === 1, `codes ${JSON.stringify(codes(ac))}; ${att3}; ${JSON.stringify(ac[0].body).slice(0, 200)}`);
  } else log('R7c no code', qr.status, JSON.stringify(qr.body).slice(0,200));
}

// R8 Add child (owner, add-child-manually) ×N with a shared family email; Guardian app "add minor" ×N
if (run('R8')) {
  const famEmail = `r5-ng-${c.run}-family@stress.test`;
  const body = { child: { firstName: 'Chiamaka', surname: 'Ọ̀ṣọ́', dateOfBirth: '2016-02-29', gender: 'FEMALE' }, guardian: { firstName: 'Ngozi', surname: 'Ọ̀ṣọ́', email: famEmail }, branchId: c.branches.ikeja };
  const rs = await burst(N, () => call('r8:add-child', 'POST', `/schools/${S}/students/add-child-manually`, c.owner.tok, body));
  const kids = await db.user.count({ where: { firstName: 'Chiamaka', surname: 'Ọ̀ṣọ́', dateOfBirth: new Date('2016-02-29') } });
  const gs = await db.user.count({ where: { email: famEmail } });
  ok('R8 Add child ×10 at once: one child, one Guardian', kids === 1 && gs === 1, `codes ${JSON.stringify(codes(rs))}; ${kids} kids, ${gs} guardians; ${JSON.stringify(rs.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  // the twin: same family email, second child, a minute later (sequential)
  const twin = await call('r8:twin', 'POST', `/schools/${S}/students/add-child-manually`, c.owner.tok, { ...body, child: { ...body.child, firstName: 'Chidi', gender: 'MALE' } });
  log('R8 twin with the same parent email:', twin.status, JSON.stringify(twin.body).slice(0, 200));
  // Guardian adds a minor in the app ×N
  const g = c.families[0].guardian;
  const mn = await burst(N, () => call('r8b:minor', 'POST', '/guardians/me/minors', g.tok, { firstName: 'Abubakar', surname: 'Ibrahim', dateOfBirth: '2018-06-12', gender: 'MALE' }));
  const nm = await db.guardianLink.count({ where: { guardianId: g.id, student: { firstName: 'Abubakar', surname: 'Ibrahim' } } });
  ok('R8b Guardian adds a child in the app, 10× at once (resent on a bad network): one child', nm === 1, `codes ${JSON.stringify(codes(mn))}; ${nm} children created; ${JSON.stringify(mn[0].body).slice(0, 200)}`);
  // and retried sequentially after a "timeout"
  const again = await call('r8c:minor-retry', 'POST', '/guardians/me/minors', g.tok, { firstName: 'Abubakar', surname: 'Ibrahim', dateOfBirth: '2018-06-12', gender: 'MALE' });
  const nm2 = await db.guardianLink.count({ where: { guardianId: g.id, student: { firstName: 'Abubakar', surname: 'Ibrahim' } } });
  log('R8c retry after timeout:', again.status, nm2, 'children now');
}

// R9 refunds ×N (charge payment), and charge create ×N, partial refund twice
if (run('R9')) {
  const s = take('sub');
  const due = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
  const ch = await burst(N, () => call('r9:charge', 'POST', `/schools/${S}/students/${s.id}/charges`, c.owner.tok, { description: 'Grading fee — ₦15,000', amount: 1500000, dueDate: due }));
  const charge = ch.find((r) => r.status < 300)?.body;
  const nch = await db.charge.count({ where: { studentId: s.id, schoolId: S } });
  ok('R9 a charge created 10× at once: one charge', nch === 1, `codes ${JSON.stringify(codes(ch))}; ${nch}`);
  const pay = await burst(N, () => call('r9:pay', 'POST', `/schools/${S}/students/${s.id}/charge-payments`, c.owner.tok, { chargeId: charge.id, amount: 1500000, paymentMethod: 'CASH', sendReceipt: false }));
  const paid = await db.transaction.findMany({ where: { studentId: s.id, schoolId: S, membershipPlanId: null } });
  ok('R9b paid in cash 10× at once: one payment', paid.length === 1, `codes ${JSON.stringify(codes(pay))}; ${paid.length}`);
  const tx = paid[0].id;
  const rf = await burst(N, () => call('r9:refund-partial', 'POST', `/schools/${S}/charge-payments/${tx}/refund`, c.owner.tok, { amount: 500000, destination: 'MONEY_BACK', notes: 'Partial: ₦5,000 back' }));
  const sum1 = (await db.chargeRefund.aggregate({ where: { transactionId: tx }, _sum: { amount: true }, _count: true }));
  ok('R9c partial refund ₦5,000 sent 10× at once: refunded once', sum1._sum.amount === 500000, `codes ${JSON.stringify(codes(rf))}; ${sum1._count} refunds totalling ${sum1._sum.amount}; ${JSON.stringify(rf.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  await sleep(1500);
  const rf2 = await call('r9:refund-partial-2', 'POST', `/schools/${S}/charge-payments/${tx}/refund`, c.owner.tok, { amount: 500000, destination: 'MONEY_BACK', notes: 'Second ₦5,000, deliberate' });
  const rfBig = await call('r9:refund-too-much', 'POST', `/schools/${S}/charge-payments/${tx}/refund`, c.owner.tok, { amount: 600000, destination: 'MONEY_BACK' });
  const sum2 = (await db.chargeRefund.aggregate({ where: { transactionId: tx }, _sum: { amount: true } }));
  ok('R9d a deliberate second partial refund works; more than what is left is refused', sum2._sum.amount <= 1500000 && rfBig.status >= 400, `second ${rf2.status} ${JSON.stringify(rf2.body).slice(0, 160)}; too much ${rfBig.status}; total ${sum2._sum.amount}`);
}

// R10 kiosk sign-up (walk-in from word of mouth) ×N, same family email for two people
if (run('R10')) {
  const setp = await call('r10:set-visitor-period', 'PATCH', `/schools/${S}`, c.owner.tok, { visitorPeriodDays: 7 });
  log('visitor period', setp.status, JSON.stringify(setp.body).slice(0, 120));
  // a visit pass given 10x at once (Decision 391)
  const vs = take('none');
  const vp = await burst(N, () => call('r10:visit-pass', 'POST', `/schools/${S}/students/${vs.id}/visit-passes`, c.staff[0].tok, {}));
  const nvp = await db.membership.count({ where: { studentId: vs.id, membershipPlan: { type: 'VISIT_PASS' } } });
  ok('R10a visit pass given 10x at once: one pass', nvp === 1, `codes ${JSON.stringify(codes(vp))}; ${nvp}; ${JSON.stringify(vp.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  const sess = await call('r10:tablet', 'POST', `/schools/${S}/front-desk/sessions`, c.staff[0].tok, { branchId: c.branches.island });
  const kt = sess.body?.sessionToken;
  const email = `r5-ng-${c.run}-walkin@stress.test`;
  const body = { kind: 'VISITOR', firstName: 'Ọ̀rẹ́olúwa', surname: 'Adébáyọ̀', dateOfBirth: '1998-02-28', gender: 'FEMALE', email, phone: '+2348031234567', heardFrom: 'Friend at church' };
  const rs = await burst(N, () => call('r10:signup', 'POST', '/front-desk/kiosk/sign-ups', kt, body));
  const n = await db.signUp.count({ where: { email } });
  ok('R10 tablet sign-up ×10 at once: one sign-up', n === 1, `tablet ${sess.status}; codes ${JSON.stringify(codes(rs))}; ${n}; ${JSON.stringify(rs.find((r) => r.status >= 300)?.body)?.slice(0, 200)}`);
  const sister = await call('r10:sister', 'POST', '/front-desk/kiosk/sign-ups', kt, { ...body, firstName: 'Ìyábọ̀', dateOfBirth: '2001-07-07' });
  log('R10b sister with the same family email:', sister.status, JSON.stringify(sister.body).slice(0, 200));
}

save();
await db.$disconnect();
