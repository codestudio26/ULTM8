// Round 6 P — "Waiver must be signed before booking or check-in" (#507, #512;
// Decisions 441 item 5, 442 item 1, 443 items 5–6). Every way to book or check
// in, for a member who hasn't signed (School A; the setting is on by default).
// Also: the past-attendance import skips it, nothing else does.
import { createRequire } from 'module';
const { DateTime } = createRequire(import.meta.url)('luxon');
import { call, must, signIn, stepUp, db, rec, refused, saveResults, loadWorld, refreshAll, at, H, D, sleep } from './lib.mjs';

const A = 'waiver';
const w = loadWorld();
await refreshAll(w);
const S = w.schools.A, SB = w.schools.B;
const P = S.people;
const C = S.classes;
const WAIVER = (r) => r.status === 403 && r.body?.error?.code === 'WAIVER_REQUIRED';
const anyWaiverRefusal = (r) => r.status >= 400 && /waiver/i.test(JSON.stringify(r.body ?? ''));
const sch = await db.school.findUnique({ where: { id: S.id }, select: { checkInRequireWaiver: true, timezone: true } });
rec(A, 'the setting is on by default for a new School', sch.checkInRequireWaiver === true, String(sch.checkInRequireWaiver));
const rules = async (on) => {
  const cur = (await must('rules', 'GET', `/schools/${S.id}/check-in-rules`, P.owner.tok));
  return must('rules put', 'PUT', `/schools/${S.id}/check-in-rules`, P.owner.tok, { ...cur, ...on });
};

// Packs sold at the desk (cash) so bookings can be paid for; buying isn't
// blocked by the waiver rule (Decision 441 item 5).
const u = P.unsigned;
for (const sid of [u.id, P.adult1.id, S.childId, S.child2Id]) {
  const has = await db.membership.findFirst({ where: { studentId: sid, schoolId: S.id, status: 'ACTIVE' } });
  if (has) continue;
  const r = await call('POST', `/schools/${S.id}/students/${sid}/memberships/sell`, P.owner.tok, { membershipPlanId: S.packId, paymentMethod: 'CASH' });
  if (sid === u.id) rec(A, 'desk sale to the unsigned member is allowed (buying not blocked)', r.status < 300, `${r.status} ${r.body?.error?.message ?? ''}`);
  else if (r.status >= 300) rec(A, 'desk sale (setup)', false, `${r.status} ${r.body?.error?.message}`);
}
// --- booking ----------------------------------------------------------------------
const r1 = await call('POST', `/classes/${C.tomorrow1}/book`, u.tok, {});
rec(A, 'app: unsigned member books → WAIVER_REQUIRED', WAIVER(r1), `${r1.status} ${r1.body?.error?.code}`);
const r2 = await call('POST', `/classes/${C.tomorrow1}/book`, P.parent.tok, { studentId: S.child2Id });
rec(A, 'parent books the unsigned child → WAIVER_REQUIRED', WAIVER(r2), `${r2.status} ${r2.body?.error?.code}`);
const r2b = await call('POST', `/classes/${C.tomorrow1}/book`, P.parent.tok, { studentId: S.childId });
rec(A, 'parent books the signed child → OK (control)', r2b.status < 300, `${r2b.status} ${r2b.body?.error?.code ?? ''}`);
// Kid Mode for the unsigned child.
{
  const del = await call('POST', `/guardians/me/minors/${S.child2Id}/booking-delegation`, P.parent.tok, {});
  const su = await stepUp(P.parent).catch(() => null);
  const kt = await call('POST', `/guardians/me/minors/${S.child2Id}/kid-mode-token`, P.parent.tok, {}, su ? { 'x-step-up-token': su } : {});
  const ktok = kt.body?.accessToken ?? kt.body?.token;
  if (!ktok) rec(A, 'Kid Mode token (setup)', false, `${del.status} ${kt.status} ${JSON.stringify(kt.body).slice(0, 200)}`);
  else {
    const r = await call('POST', `/classes/${C.tomorrow1}/book`, ktok, { studentId: S.child2Id });
    rec(A, 'Kid Mode: unsigned child books → WAIVER_REQUIRED', WAIVER(r), `${r.status} ${r.body?.error?.code}`);
  }
}
const r3 = await call('POST', `/classes/${C.tomorrow1}/book`, P.staff1.tok, { studentId: u.id });
rec(A, 'staff books the unsigned member → WAIVER_REQUIRED', WAIVER(r3), `${r3.status} ${r3.body?.error?.code}`);
const r3b = await call('POST', `/classes/${C.tomorrow1}/book`, P.owner.tok, { studentId: u.id, overrideReason: 'Owner says ok' });
rec(A, "owner's override reason doesn't skip it (staff can't override)", WAIVER(r3b), `${r3b.status} ${r3b.body?.error?.code}`);
const r3c = await call('POST', `/classes/${C.tomorrow1}/book`, P.coach.tok, { studentId: u.id });
rec(A, 'coach books the unsigned member → refused', r3c.status >= 400, `${r3c.status} ${r3c.body?.error?.code}`);

// --- the class waiting list --------------------------------------------------------
await must('fill small', 'POST', `/classes/${C.small1}/book`, P.adult1.tok, {});
const wl = await call('POST', `/classes/${C.small1}/waitlist`, u.tok, {});
rec(A, 'joining a waiting list unsigned → WAIVER_REQUIRED', WAIVER(wl), `${wl.status} ${wl.body?.error?.code}`);
const wlp = await call('POST', `/classes/${C.small1}/waitlist`, P.parent.tok, { studentId: S.child2Id });
rec(A, 'parent puts the unsigned child on a waiting list → WAIVER_REQUIRED', WAIVER(wlp), `${wlp.status} ${wlp.body?.error?.code}`);
// Claim: join while the setting is off, then switch on, free the place, claim.
await rules({ requireWaiver: false });
const wl2 = await must('join wl (rule off)', 'POST', `/classes/${C.small1}/waitlist`, u.tok, {});
await rules({ requireWaiver: true });
const adultBooking = await db.booking.findFirst({ where: { studentId: P.adult1.id, classId: C.small1, status: 'UPCOMING' } });
await must('free place', 'PATCH', `/bookings/${adultBooking.id}/cancel`, P.adult1.tok, {});
let entry;
for (let i = 0; i < 40; i++) {
  entry = await db.waitlistEntry.findFirst({ where: { studentId: u.id, classId: C.small1 } });
  if (entry?.status === 'NOTIFIED') break;
  await sleep(250);
}
const claim = await call('POST', `/waitlist/${wl2.id ?? entry.id}/claim`, u.tok, {});
const claimed = await db.booking.findFirst({ where: { studentId: u.id, classId: C.small1, status: 'UPCOMING' } });
rec(A, 'claiming an offered place unsigned → refused, no booking', anyWaiverRefusal(claim) && !claimed, `entry ${entry?.status}; claim ${claim.status} ${claim.body?.error?.code ?? ''}; booked=${!!claimed}`);

// --- check-in ----------------------------------------------------------------------
// The unsigned member gets a booking on the class happening now while the rule
// is off (as anyone booked before the School's waiver existed), then every way
// of checking in is tried with the rule on.
await rules({ requireWaiver: false });
const bk = await must('book now (rule off)', 'POST', `/classes/${C.now1}/book`, u.tok, {});
const kidBk = await must('book child2 now (rule off)', 'POST', `/classes/${C.now1}/book`, P.parent.tok, { studentId: S.child2Id });
await rules({ requireWaiver: true });
const stillUpcoming = async (sid = u.id) => (await db.booking.findFirst({ where: { studentId: sid, classId: C.now1 }, orderBy: { createdAt: 'desc' } }))?.status;
// app QR
const qr = await call('GET', `/classes/${C.now1}/qr-token`, P.owner.tok);
const scan = await call('POST', '/attendance/scan', u.tok, { classId: C.now1, qrToken: qr.body?.token ?? qr.body?.qrToken });
rec(A, 'app: scanning the class QR unsigned → refused', scan.status >= 400 && (await stillUpcoming()) === 'UPCOMING', `${scan.status} ${scan.body?.error?.code ?? ''}`);
// class code
const code = qr.body?.code ?? qr.body?.attendanceCode;
if (code) {
  const cr = await call('POST', '/attendance/code', u.tok, { classId: C.now1, code });
  rec(A, 'app: typing the class code unsigned → refused', cr.status >= 400 && (await stillUpcoming()) === 'UPCOMING', `${cr.status} ${cr.body?.error?.code ?? ''}`);
} else rec(A, 'class code (no code in qr-token response)', null, Object.keys(qr.body ?? {}).join(','));
// coach scan of the member's QR
const mine = await call('GET', '/attendance/my-qr-token', u.tok);
const cs = await call('POST', `/classes/${C.now1}/attendance-scan`, P.coach.tok, { studentId: u.id, studentToken: mine.body?.token });
rec(A, "coach scans the member's QR → refused", cs.status >= 400 && (await stillUpcoming()) === 'UPCOMING', `${cs.status} ${cs.body?.error?.code ?? ''}`);
const csm = await call('POST', `/classes/${C.now1}/attendance-scan`, P.owner.tok, { studentId: u.id });
rec(A, 'owner marks them present by hand (instructor manual) → refused', csm.status >= 400 && (await stillUpcoming()) === 'UPCOMING', `${csm.status} ${csm.body?.error?.code ?? ''}`);
// front desk
const desk = await call('POST', `/schools/${S.id}/front-desk/check-ins`, P.staff1.tok, { studentId: u.id, classIds: [C.now1] });
rec(A, 'front desk checks in the unsigned member → refused', (desk.status >= 400 || desk.body?.classes?.every?.((x) => !x.ok)) && (await stillUpcoming()) === 'UPCOMING', `${desk.status} ${JSON.stringify(desk.body).slice(0, 160)}`);
const deskKid = await call('POST', `/schools/${S.id}/front-desk/check-ins`, P.owner.tok, { studentId: S.child2Id, classIds: [C.now1] });
rec(A, 'front desk checks in the unsigned child → refused', (deskKid.status >= 400 || deskKid.body?.classes?.every?.((x) => !x.ok)) && (await stillUpcoming(S.child2Id)) === 'UPCOMING', `${deskKid.status} ${JSON.stringify(deskKid.body).slice(0, 160)}`);
// The desk books and checks in someone with no booking (another class).
const deskNew = await call('POST', `/schools/${S.id}/front-desk/check-ins`, P.owner.tok, { studentId: u.id, classIds: [C.now2] });
rec(A, 'front desk book+check-in at the other Branch → refused', deskNew.status >= 400 || deskNew.body?.classes?.every?.((x) => !x.ok), `${deskNew.status} ${JSON.stringify(deskNew.body).slice(0, 160)}`);
// locked tablet (kiosk)
{
  const ses = await call('POST', `/schools/${S.id}/front-desk/sessions`, P.owner.tok, { branchId: S.b1 });
  const kt = ses.body?.sessionToken;
  if (!kt) rec(A, 'kiosk session (setup)', false, `${ses.status} ${JSON.stringify(ses.body).slice(0, 150)}`);
  else {
    const look = await call('POST', '/front-desk/kiosk/qr-lookups', kt, { studentToken: (await call('GET', '/attendance/my-qr-token', u.tok)).body?.token });
    const kc = await call('POST', '/front-desk/kiosk/check-ins', kt, { studentId: u.id, classIds: [C.now1], lookupToken: look.body?.lookupToken });
    rec(A, 'locked tablet: QR then check in → refused', (kc.status >= 400 || kc.body?.classes?.every?.((x) => !x.ok)) && (await stillUpcoming()) === 'UPCOMING', `lookup ${look.status}; ${kc.status} ${JSON.stringify(kc.body).slice(0, 160)}`);
    await call('POST', `/schools/${S.id}/front-desk/sessions/${ses.body.sessionId}/end`, P.owner.tok, {});
  }
}
// check in without a booking (app QR) when "a booking is needed" is off
await rules({ requireBooking: false });
const qr2 = await call('GET', `/classes/${C.now2}/qr-token`, P.owner.tok);
const scan2 = await call('POST', '/attendance/scan', u.tok, { classId: C.now2, qrToken: qr2.body?.token ?? qr2.body?.qrToken });
const b2 = await db.booking.findFirst({ where: { studentId: u.id, classId: C.now2 } });
rec(A, 'check-in without a booking (app QR) unsigned → refused, nothing booked', scan2.status >= 400 && !b2, `${scan2.status} ${scan2.body?.error?.code ?? ''} booking=${b2?.status}`);
await rules({ requireBooking: true });
// staff "log past attendance" (not an import): the rule applies.
{
  const lg = await call('POST', `/schools/${S.id}/attendance/logs`, P.owner.tok, { studentId: u.id, classId: C.past1 });
  rec(A, 'staff log of a past visit (not an import) → refused by the waiver rule', anyWaiverRefusal(lg), `${lg.status} ${lg.body?.error?.code ?? ''} ${lg.body?.error?.message ?? ''}`);
}
// The past-attendance import: skips the waiver, nothing else.
{
  const cls = await db.class.findUnique({ where: { id: C.past1 } });
  const start = new Date(Math.floor(cls.startDate.getTime() / 60000) * 60000);
  await db.class.update({ where: { id: C.past1 }, data: { startDate: start } });
  const local = DateTime.fromJSDate(start, { zone: sch.timezone });
  const row = { email: u.email, first_name: u.first, last_name: u.last, date: local.toISODate(), time: local.toFormat('HH:mm'), class: 'Past North' };
  const imp = await call('POST', `/schools/${S.id}/imports`, P.owner.tok, { kind: 'ATTENDANCE', totalRows: 1, fileName: 'past.csv' });
  const rows = imp.status < 300 ? await call('POST', `/schools/${S.id}/imports/${imp.body.id}/rows`, P.owner.tok, { rows: [{ rowNumber: 2, values: row }] }) : imp;
  const att = await db.booking.findFirst({ where: { studentId: u.id, classId: C.past1, status: 'COMPLETED' } });
  rec(A, 'past-attendance import of an unsigned member → imported (Decision 442 item 1)', !!att, `${imp.status} ${JSON.stringify(rows.body).slice(0, 220)}`);
}

// --- what counts as signed ---------------------------------------------------------
// A's adult1 joins School B: their School A signature mustn't count at B.
{
  await must('join B', 'POST', `/schools/${SB.id}/join`, P.adult1.tok, { branchId: SB.b1 });
  await signIn(P.adult1);
  const r = await call('POST', `/classes/${SB.classes.tomorrow1}/book`, P.adult1.tok, {});
  rec(A, "a signature at School A doesn't count at School B", WAIVER(r), `${r.status} ${r.body?.error?.code}`);
}
// The only waiver archived: nobody is stopped (Decision 442 kept-as-built).
{
  await must('archive', 'POST', `/waivers/${S.waiverId}/archive`, P.owner.tok, {});
  const r = await call('POST', `/classes/${C.tomorrow1}/book`, u.tok, {});
  rec(A, 'with no waiver in use, the unsigned member may book (as built)', r.status < 300, `${r.status} ${r.body?.error?.code ?? ''}`);
  await must('unarchive', 'POST', `/waivers/${S.waiverId}/unarchive`, P.owner.tok, {});
}
// Who may switch the rule: owners and staff with "Change check-in rules" only.
{
  const cur = await must('rules', 'GET', `/schools/${S.id}/check-in-rules`, P.owner.tok);
  refused(A, "staff without 'Change check-in rules' can't switch it off", await call('PUT', `/schools/${S.id}/check-in-rules`, P.staff1.tok, { ...cur, requireWaiver: false }), [403]);
  refused(A, "a coach can't switch it off", await call('PUT', `/schools/${S.id}/check-in-rules`, P.coach.tok, { ...cur, requireWaiver: false }), [403]);
  refused(A, "School B's owner can't switch School A's off", await call('PUT', `/schools/${S.id}/check-in-rules`, SB.people.owner.tok, { ...cur, requireWaiver: false }), [403, 404]);
  refused(A, "a member can't switch it off", await call('PUT', `/schools/${S.id}/check-in-rules`, u.tok, { ...cur, requireWaiver: false }), [403, 404]);
}
// Signing for someone else's child (so they can book).
{
  const r = await call('POST', `/waivers/${S.waiverId}/sign`, P.adult2.tok, { studentId: S.child2Id, signerFullName: 'Not The Parent', signatureText: 'Not The Parent' });
  rec(A, "a non-parent can't sign for someone else's child", r.status >= 400, `${r.status} ${r.body?.error?.message ?? ''}`);
  const r2 = await call('POST', `/waivers/${S.waiverId}/sign`, SB.people.owner.tok, { studentId: u.id, signerFullName: 'X', signatureText: 'X' });
  rec(A, "another School's owner can't sign for a member", r2.status >= 400, `${r2.status} ${r2.body?.error?.message ?? ''}`);
  const r3 = await call('POST', `/waivers/${S.waiverId}/sign`, P.owner.tok, { studentId: u.id, signerFullName: 'Owner For Them', signatureText: 'Owner For Them' });
  rec(A, "the owner can't e-sign for an adult member", r3.status >= 400, `${r3.status} ${r3.body?.error?.message ?? ''}`);
}
saveResults('waiver');
await db.$disconnect();
