// Journey 5: "Delete my account" (Decisions 436 items 1–6, 440).
//  a) An adult asks, is locked out at once, signs in again within 30 days and
//     the deletion is cancelled.
//  b) A parent who is the only parent of a child with no login asks: the child
//     is named and goes too. Then "30 days later" (the due date moved back,
//     the only stand-in for the clock) the daily erasure job runs, and the
//     anonymising, the cancelled bookings and the cleared notes and files are
//     checked in the database.
import { call, must, journey, check, ok, step, signIn, stepUp, runJob, db, days, API } from './lib.mjs';
import { joinSchool } from './j3-members.mjs';

const R2 = `http://localhost:${process.env.REHEARSAL_R2_PORT || 12518}`;

async function requestDeletion(person) {
  const su = await stepUp(person);
  return call('POST', '/users/me/deletion', person.tok, undefined, { 'x-step-up-token': su });
}

export async function j5Delete(s) {
  const c = s.cfg;
  if (!s.school || !s.adult) return;
  journey(c.key, '5', 'Delete my account');
  const sid = s.school.id;
  const O = () => s.owner.tok;

  // --- a) the adult changes their mind ---
  const a = s.adult;
  const pre = await call('GET', '/users/me/deletion', a.tok);
  ok('adult sees what deleting means (30 days, nothing pending)', pre.status === 200 && pre.body?.graceDays === 30, JSON.stringify(pre.body).slice(0, 220));
  const noStepUp = await call('POST', '/users/me/deletion', a.tok);
  ok('asking needs the passcode again (step-up)', noStepUp.status >= 400, `${noStepUp.status} ${noStepUp.body?.error?.message ?? ''}`);
  const oldTok = a.tok, oldRefresh = a.refresh;
  const req = await requestDeletion(a);
  ok('adult asks to delete their account', req.status < 300 && !!req.body?.dueAt, `${req.status} due ${req.body?.dueAt ?? JSON.stringify(req.body).slice(0, 160)}`);
  const locked = await call('GET', '/memberships/me', oldTok);
  const refreshed = await call('POST', '/auth/refresh', null, { refreshToken: oldRefresh });
  ok('the account is locked at once (old session and refresh refused)', locked.status === 401 && refreshed.status === 401, `old token ${locked.status} ${locked.body?.error?.code ?? ''}; refresh ${refreshed.status}`);
  const staffBook = await call('POST', `/classes/${s.smallClass.id}/book`, O(), { studentId: a.id, overrideReason: 'rehearsal' });
  check('staff can\'t book for a locked member', staffBook.status >= 400 ? 'PASS' : 'FAIL', `${staffBook.status} ${staffBook.body?.error?.message ?? ''}`);
  const back = await signIn(a);
  const u = await db.user.findUnique({ where: { id: a.id } });
  ok('signing in again within 30 days cancels the deletion', back?.deletionCancelled === true && u.deletionRequestedAt === null && u.erasedAt === null, `login says deletionCancelled=${back?.deletionCancelled}; deletionRequestedAt ${u.deletionRequestedAt}`);
  const again = await call('GET', '/memberships/me', a.tok);
  ok('and they can use the app as before', again.status === 200 && (again.body?.items ?? []).length > 0, `${again.status}; ${(again.body?.items ?? []).length} memberships`);

  // --- b) a parent who is a child's only parent; the child has no login ---
  const p = s.lonely;
  if (!p) { check('parent who is the only parent', 'BLOCKED', 'journey 4 did not create the third member'); return; }
  const [kf, kl] = c.names.lonelyKid;
  const kid = await step('the parent adds a child (no login of their own)', () => must('add child', 'POST', '/guardians/me/minors', p.tok, { firstName: kf, surname: kl, dateOfBirth: '2017-09-09', consentPolicyVersion: '1.0-placeholder' }));
  if (!kid) return;
  const kidId = kid.studentId;
  await joinSchool(s, p, kidId);
  await must('child waiver', 'POST', `/waivers/${s.waiver.id}/sign`, p.tok, { studentId: kidId, signerFullName: `${p.first} ${p.last}`, signatureText: `${p.first} ${p.last}` });
  await must('desk sale for child', 'POST', `/schools/${sid}/students/${kidId}/memberships/sell`, O(), { membershipPlanId: s.plans.kids.id, paymentMethod: 'CASH' });
  // A class next week from the timetable, booked for the child.
  const nextClass = await db.class.findFirst({ where: { schoolId: sid, timetableSlotId: { not: null }, startDate: { gt: new Date(Date.now() + days(1)) } }, orderBy: { startDate: 'asc' } });
  const kb = await call('POST', `/classes/${nextClass.id}/book`, p.tok, { studentId: kidId });
  // The owner's notes and a file for the child and the parent.
  await must('note kid', 'POST', `/schools/${sid}/students/${kidId}/notes`, O(), { body: c.key === 'B' ? 'Alergia a amendoim' : 'Asthma: inhaler in bag', showToMember: false });
  await must('note parent', 'POST', `/schools/${sid}/students/${p.id}/notes`, O(), { body: c.key === 'B' ? 'Prefere contato por WhatsApp' : 'Prefers texts', showToMember: true });
  const fd = new FormData();
  fd.append('file', new Blob(['%PDF-1.4 rehearsal medical form'], { type: 'application/pdf' }), 'medical-form.pdf');
  const up = await fetch(`${API}/schools/${sid}/students/${kidId}/files`, { method: 'POST', headers: { authorization: `Bearer ${O()}` }, body: fd });
  const upBody = await up.json().catch(() => null);
  ok('setup: the child is booked, has notes and a file', kb.status < 300 && up.status < 300, `booking ${kb.status} ${kb.body?.error?.message ?? ''}; file upload ${up.status} ${upBody?.error?.message ?? ''}`);
  const keysBefore = await (await fetch(R2)).json();

  const prev = await call('GET', '/users/me/deletion', p.tok);
  const named = JSON.stringify(prev.body?.childrenDeleted ?? prev.body?.children ?? prev.body);
  ok('the confirmation names the child who will be deleted too', prev.status === 200 && named.includes(kf), named.slice(0, 220));
  const req2 = await requestDeletion(p);
  const kidRow = await db.user.findUnique({ where: { id: kidId } });
  ok('the parent asks; the child is marked for deletion with them', req2.status < 300 && !!kidRow.deletionRequestedAt && kidRow.deletionRequestedById === p.id, `${req2.status}; child deletionRequestedAt ${kidRow.deletionRequestedAt?.toISOString()}`);

  // "30 days later": move both due dates (and the request) back 31 days.
  await db.user.updateMany({ where: { id: { in: [p.id, kidId] } }, data: { deletionRequestedAt: new Date(Date.now() - days(31)), deletionDueAt: new Date(Date.now() - days(1)) } });
  const job = await step('the daily erasure job runs', () => runJob('account-erasure'));
  check('the daily erasure job runs', job === undefined ? 'FAIL' : 'PASS', JSON.stringify(job ?? null));

  const [pu, ku] = await Promise.all([db.user.findUnique({ where: { id: p.id } }), db.user.findUnique({ where: { id: kidId } })]);
  const anon = (x) => x && x.erasedAt && !x.email?.includes('@rehearsal.test') && x.phone === null && x.dateOfBirth === null && /Erased/.test(`${x.firstName} ${x.surname}`) && x.medicalInfo == null;
  ok('parent anonymised ("Erased User": no email, phone, birth date)', anon(pu), `name "${pu?.firstName} ${pu?.surname}", email ${pu?.email}, phone ${pu?.phone}, dob ${pu?.dateOfBirth}, erasedAt ${pu?.erasedAt?.toISOString()}`);
  ok('child anonymised too', anon(ku), `name "${ku?.firstName} ${ku?.surname}", email ${ku?.email}, dob ${ku?.dateOfBirth}`);
  const kidBooking = await db.booking.findFirst({ where: { classId: nextClass.id, studentId: kidId } });
  ok('the child\'s upcoming booking is cancelled', kidBooking?.status === 'CANCELLED', `booking ${kidBooking?.status}`);
  // A plan's waiting list is tidied by its own job (every 15 minutes), which
  // closes the place of anyone no longer at the School, as when a School
  // removes a member.
  const pwl0 = await db.planWaitlistEntry.findMany({ where: { studentId: p.id } });
  const roles = await db.roleGrant.count({ where: { userId: { in: [p.id, kidId] }, revokedAt: null } });
  await runJob('plan-waitlist');
  const pwl = await db.planWaitlistEntry.findMany({ where: { studentId: p.id } });
  ok('their roles end, and the plan waiting-list place is given up at the next 15-minute run', roles === 0 && pwl.length > 0 && pwl.every((w) => w.status === 'LEFT'), `active roles ${roles}; plan waiting list ${JSON.stringify(pwl0.map((w) => w.status))} → ${JSON.stringify(pwl.map((w) => w.status))}`);
  const notes = await db.studentNote.count({ where: { studentId: { in: [p.id, kidId] } } });
  ok('staff notes about them are cleared', notes === 0, `${notes} notes left`);
  const files = await db.memberFile.count({ where: { studentId: kidId } });
  const keysAfter = await (await fetch(R2)).json();
  ok('the file the School uploaded is deleted (row and stored copy)', files === 0 && keysAfter.length < keysBefore.length, `${files} file rows; stored copies ${keysBefore.length} → ${keysAfter.length}`);
  const tx = await db.transaction.count({ where: { studentId: { in: [p.id, kidId] } } });
  const sig = await db.waiverSignature.findFirst({ where: { studentId: kidId } });
  ok('payments and the signed waiver stay with the School, unnamed', tx > 0 && !!sig && /Erased/.test(sig.signerFullName ?? ''), `${tx} payments kept; waiver signer "${sig?.signerFullName}"`);
  const login = await call('POST', '/auth/login', null, { email: p.email, passcode: p.passcode });
  ok('the erased account can never sign in', login.status === 401, `${login.status}`);
  const notices = await db.notification.findMany({ where: { userId: s.owner.id, type: 'MEMBER_LEFT' } }).catch(() => []);
  ok('the School\'s owner gets a notice that doesn\'t name them', notices.length > 0 && notices.every((n) => !`${n.title} ${n.body}`.includes(p.last)), notices.map((n) => `${n.title}: ${n.body}`).join(' | ').slice(0, 220));
  const log = await db.accountErasureLog.findMany({ where: { userId: { in: [p.id, kidId] } } });
  ok('a permanent record without personal details is kept', log.some((l) => l.event === 'ERASED'), log.map((l) => l.event).join(','));
  const staffList = await call('GET', `/schools/${sid}/students`, O());
  const shown = JSON.stringify(staffList.body);
  ok('the Students list no longer shows their names', staffList.status === 200 && !shown.includes(p.last) && !shown.includes(kf), `${staffList.status}; ${shown.includes('Erased') ? 'shows "Erased User"' : 'not listed'}`);
}
