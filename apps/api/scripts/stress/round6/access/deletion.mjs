// Round 6 P — "Delete my account" (Decisions 436 items 1–6, 440) from other
// people's side: who can still act on a locked member, signing back in, and
// what anyone can still see once the account is erased. Also Decision 444
// item 3: LegalAcceptance rows survive and hold nothing personal.
//
// The "leaver" is a fresh adult who is a member of School A (home North) and
// of School B, and a coach at School B with a coach profile (phone, bio).
// "30 days later" is reached by moving deletionDueAt back (harness shortcut,
// as the launch rehearsal does), then the erasure job runs from its queue.
import { call, must, signUp, signIn, stepUp, runJob, db, rec, refused, saveResults, loadWorld, refreshAll, sleep, RUN } from './lib.mjs';

const A = 'deletion';
const w = loadWorld();
await refreshAll(w);
const SA = w.schools.A, SB = w.schools.B;
const PA = SA.people, PB = SB.people;

// A surname unique to this run, so a leak check can't match someone else
// (an earlier run's leaver who was never erased).
const SUR = `Leaver${RUN.replace(/[^a-z0-9]/gi, '')}q`;
const PH = `9${String(Date.now()).slice(-5)}`;
const L = await signUp({ first: 'Lena', last: SUR, dob: '1991-07-07' });
const OLD = { first: L.first, last: L.last, email: L.email, phone: L.phone };
await must('join A', 'POST', `/schools/${SA.id}/join`, L.tok, { branchId: SA.b1 });
await must('join B', 'POST', `/schools/${SB.id}/join`, L.tok, { branchId: SB.b1 });
await signIn(L);
await must('sign A', 'POST', `/waivers/${SA.waiverId}/sign`, L.tok, { signerFullName: `Lena ${SUR}`, signatureText: `Lena ${SUR}` });
await must('sign B', 'POST', `/waivers/${SB.waiverId}/sign`, L.tok, { signerFullName: `Lena ${SUR}`, signatureText: `Lena ${SUR}` });
await must('pack A', 'POST', `/schools/${SA.id}/students/${L.id}/memberships/sell`, PA.owner.tok, { membershipPlanId: SA.packId, paymentMethod: 'CASH' });
await must('book A', 'POST', `/classes/${SA.classes.tomorrow1}/book`, L.tok, {});
await must('note', 'POST', `/schools/${SA.id}/students/${L.id}/notes`, PA.owner.tok, { body: `Lena ${SUR} has a bad knee; call ${PH}.` });
// Coach at School B with a profile.
await must('coach grant', 'POST', `/users/${L.id}/role-grants`, PB.owner.tok, { role: 'INSTRUCTOR', schoolId: SB.id, branchId: SB.b1 });
await signIn(L);
const inst = await must('coach profile', 'POST', `/schools/${SB.id}/instructors`, PB.owner.tok, { userId: L.id, branchId: SB.b1, specializationStyleIds: [SB.styleId], phone: `+55119870${PH.slice(1)}`, bio: `Lena ${SUR}, black belt, lives in Hackney${SUR}.`, photoUrl: 'https://ci-test-public-photos.example.test/instructors/lena.jpg' });
// A Pix order at School B: the "Cash payment waiting" notice names her to owners/staff.
const ord = await must('pix order', 'POST', `/membership-plans/${SB.packId}/purchase`, L.tok, {});
await sleep(2500);

// --- 1. request deletion; the account is locked ------------------------------------
const su = await stepUp(L);
const req = await call('POST', '/users/me/deletion', L.tok, undefined, { 'x-step-up-token': su });
rec(A, 'leaver asks to delete their account', req.status === 200 && req.body?.pending === true, `${req.status} due ${req.body?.dueAt}`);
refused(A, "the leaver's own session is refused at once", await call('GET', '/bookings/me', L.tok), [401, 403]);
const bookStaff = await call('POST', `/classes/${SA.classes.now1}/book`, PA.staff1.tok, { studentId: L.id });
rec(A, "staff can't book the locked member", bookStaff.status === 403 && bookStaff.body?.error?.code === 'ACCOUNT_CLOSING', `${bookStaff.status} ${bookStaff.body?.error?.code}`);
const desk = await call('POST', `/schools/${SA.id}/front-desk/check-ins`, PA.owner.tok, { studentId: L.id, classIds: [SA.classes.now1] });
rec(A, "the front desk can't check the locked member in", desk.status >= 400 || desk.body?.classes?.every?.((x) => !x.ok), `${desk.status} ${JSON.stringify(desk.body).slice(0, 140)}`);
const sell = await call('POST', `/schools/${SA.id}/students/${L.id}/memberships/sell`, PA.owner.tok, { membershipPlanId: SA.packId, paymentMethod: 'CASH' });
rec(A, "the owner can't sell to the locked member", sell.status === 403, `${sell.status} ${sell.body?.error?.code}`);
const gift = await call('POST', `/schools/${SA.id}/students/${L.id}/memberships/gift`, PA.owner.tok, { membershipPlanId: SA.packId });
rec(A, "the owner can't gift a plan to the locked member", gift.status >= 400, `${gift.status} ${gift.body?.error?.code ?? ''} ${gift.body?.error?.message ?? ''}`);
const charge = await call('POST', `/schools/${SA.id}/students/${L.id}/charges`, PA.owner.tok, { description: 'Kit', amount: 1000, dueDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10) });
rec(A, 'a charge on the locked member (not covered by Decision 440)', null, `${charge.status} ${charge.body?.error?.code ?? ''} ${charge.body?.error?.message ?? ''}`);
const confirm = await call('PATCH', `/transactions/${ord.transactionId}/confirm`, PB.owner.tok, {});
rec(A, "confirming the locked member's waiting Pix order (sale completes?)", confirm.status >= 400, `${confirm.status} ${confirm.body?.error?.code ?? ''}`);
const kiosk = await call('POST', `/schools/${SA.id}/front-desk/sessions`, PA.owner.tok, { branchId: SA.b1 });
if (kiosk.body?.sessionToken) {
  const fm = await call('POST', '/front-desk/kiosk/find-me', kiosk.body.sessionToken, { fullName: `Lena ${SUR}`, dateOfBirth: '1991-07-07' });
  rec(A, 'locked tablet "find me" for the locked member (during the 30 days)', null, `${fm.status} ${JSON.stringify(fm.body).slice(0, 160)}`);
  await call('POST', `/schools/${SA.id}/front-desk/sessions/${kiosk.body.sessionId}/end`, PA.owner.tok, {});
}

// --- 2. signing back in cancels it ----------------------------------------------------
await signIn(L);
const st = await call('GET', '/users/me/deletion', L.tok);
rec(A, 'signing back in within 30 days cancels the deletion', st.status === 200 && st.body?.pending === false, `${st.status} pending=${st.body?.pending}`);
const bookAgain = await call('POST', `/classes/${SA.classes.now1}/book`, PA.staff1.tok, { studentId: L.id });
rec(A, 'after cancelling, staff can book them again', bookAgain.status < 300 || bookAgain.body?.error?.code !== 'ACCOUNT_CLOSING', `${bookAgain.status} ${bookAgain.body?.error?.code ?? ''}`);

// --- 3. request again; 30 days pass; erased ---------------------------------------
const su2 = await stepUp(L);
await must('request again', 'POST', '/users/me/deletion', L.tok, undefined, { 'x-step-up-token': su2 });
const oldTok = L.tok;
await db.user.update({ where: { id: L.id }, data: { deletionDueAt: new Date(Date.now() - 60e3) } });
await runJob('account-erasure');
const u = await db.user.findUnique({ where: { id: L.id } });
rec(A, 'the erasure job anonymised the account', !!u.erasedAt && u.firstName === 'Erased' && u.phone === null && !u.email.includes(SUR.toLowerCase()), `${u.firstName} ${u.surname} ${u.email}`);

// --- 4. what other people can still see ----------------------------------------------
const hay = (x) => JSON.stringify(x ?? '').toLowerCase();
const leaks = (x) => [SUR.toLowerCase(), OLD.email.toLowerCase(), PH.slice(1), OLD.phone.slice(-6)].filter((s) => hay(x).includes(s));
const look = async (label, tok, path) => {
  const r = await call('GET', path, tok);
  const l = leaks(r.body);
  rec(A, `after erasure, ${label} (${path.replace(/[0-9a-f-]{36}/g, ':id')}) shows nothing personal`, l.length === 0, `${r.status} ${l.length ? 'LEAKS: ' + l.join(',') + ' ' + hay(r.body).slice(Math.max(0, hay(r.body).indexOf(l[0]) - 80), hay(r.body).indexOf(l[0]) + 80) : ''}`);
};
await look('School A owner: student list', PA.owner.tok, `/schools/${SA.id}/students?search=Lena`);
await look('School A owner: student list (all)', PA.owner.tok, `/schools/${SA.id}/students`);
await look('School A owner: student profile', PA.owner.tok, `/schools/${SA.id}/students/${L.id}/profile`);
await look('School A owner: waiver signatures', PA.owner.tok, `/schools/${SA.id}/waivers/${SA.waiverId}/signatures`);
await look('School A owner: class bookings', PA.owner.tok, `/classes/${SA.classes.tomorrow1}/bookings`);
await look('School A owner: staff activity', PA.owner.tok, `/schools/${SA.id}/staff/activity`);
await look('School A owner: transactions', PA.owner.tok, `/schools/${SA.id}/transactions`);
await look('School A owner: notifications', PA.owner.tok, '/notifications/me');
await look('School B owner: notifications', PB.owner.tok, '/notifications/me');
await look('School B North staff: notifications', PB.staff1.tok, '/notifications/me');
await look('School B owner: transactions', PB.owner.tok, `/schools/${SB.id}/transactions`);
await look('School B owner: instructors list', PB.owner.tok, `/schools/${SB.id}/instructors`);
await look('School B member: instructors list', PB.adult1.tok, `/schools/${SB.id}/instructors`);
await look('School B owner: instructor profile', PB.owner.tok, `/instructors/${inst.id}`);
await look('School B owner: staff list', PB.owner.tok, `/schools/${SB.id}/staff`);
await look('School B owner: student list', PB.owner.tok, `/schools/${SB.id}/students`);
await look('School A owner: data export of the erased member', PA.owner.tok, `/schools/${SA.id}/students/${L.id}/data-export`);
await look('School A member: class bookings (attendee list)', PA.adult1.tok, `/classes/${SA.classes.tomorrow1}/bookings`);
// Database-level sweep for her old details in any text/json column.
{
  const rows = await db.$queryRawUnsafe(`
    SELECT c.table_name t, c.column_name col FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.data_type IN ('text','jsonb','json','character varying')
      AND c.table_name NOT LIKE 'AuditLogEntry_%' AND c.table_name NOT LIKE '_prisma%'`);
  const hits = [];
  for (const { t, col } of rows) {
    const q = await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}" WHERE "${col}"::text ILIKE $1 OR "${col}"::text ILIKE $2 OR "${col}"::text ILIKE $3`, `%${SUR}%`, `%${OLD.email}%`, `%${PH.slice(1)}%`);
    if (q[0].n > 0) hits.push(`${t}.${col}=${q[0].n}`);
  }
  rec(A, 'database: no table still holds her name, email or phone', hits.length === 0, hits.join(' '));
}
// LegalAcceptance (Decision 444 item 3).
{
  const la = await db.legalAcceptance.findMany({ where: { userId: L.id } });
  rec(A, 'her LegalAcceptance rows are kept', la.length >= 2, `${la.length} rows`);
  rec(A, 'and hold nothing personal (only ids, page, version, time)', la.every((r) => Object.keys(r).sort().join(',') === 'acceptedAt,documentSlug,franchiseId,id,schoolId,userId,version'), Object.keys(la[0] ?? {}).join(','));
}

// --- 5. signing back in after erasure, a new account with the same email ------------
const back = await call('POST', '/auth/login', null, { email: OLD.email, passcode: L.passcode });
rec(A, "after erasure the old email and passcode don't sign in", back.status === 401 || back.status === 400, `${back.status}`);
refused(A, 'an old access token is refused after erasure', await call('GET', '/bookings/me', oldTok), [401, 403]);
const again = await call('POST', '/auth/register', null, { email: OLD.email, phone: OLD.phone, firstName: 'Lena', surname: SUR, passcode: '482913', passcodeConfirm: '482913', dateOfBirth: '1991-07-07', acceptTerms: true });
rec(A, 'the same person can sign up again with the same email and phone', again.status < 300, `${again.status} ${again.body?.error?.message ?? ''}`);
if (again.status < 300) {
  await call('POST', '/auth/otp/verify', null, { phone: OLD.phone, code: '123456' });
  const n = { email: OLD.email, passcode: '482913' };
  await signIn(n);
  const mine = await call('GET', '/memberships/me', n.tok);
  const bk = await call('GET', '/bookings/me', n.tok);
  rec(A, 'the new account gets none of the old one\'s memberships or bookings', (mine.body?.items ?? mine.body ?? []).length === 0 && (bk.body?.items ?? bk.body ?? []).length === 0, `${JSON.stringify(mine.body).slice(0, 80)} ${JSON.stringify(bk.body).slice(0, 80)}`);
}
saveResults('deletion');
await db.$disconnect();
