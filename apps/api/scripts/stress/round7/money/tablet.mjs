// Round 7, D check 5: approved tablet sign-ups count as "signed up themselves"
// (#531 item 13, Decision 449 item 13). A School in Pacific/Honolulu (UTC-10),
// so someone born 18 years ago "today in the earliest time zone" (Kiritimati,
// UTC+14, always one calendar day ahead of Honolulu) is 18 for the tablet and
// for self sign-up, and still 17 on the School's own date.
//   T1 approved tablet sign-up -> waiver and purchase allowed (self rule)
//   T2 the same birthday, added manually by staff -> refused (School's date)
//   T3 an existing staff-made account, linked by a tablet sign-up -> still refused (keeps its status)
//   T4 an existing self-signed-up account, linked by a tablet sign-up -> still allowed
import { call, must, db, rec, expect, saveOut, makeSchool, plan, signUp, RUN } from './lib.mjs';

const A = 'tablet';
const days = (n) => n * 86400e3;
const kiritimatiDay = (offsetDays = 0) => new Date(Date.now() + 14 * 3600e3 + days(offsetDays)).toISOString().slice(0, 10);
const yearsBefore = (day, n) => `${Number(day.slice(0, 4)) - n}${day.slice(4)}`;
const DOB = yearsBefore(kiritimatiDay(0), 18);

async function firstSignIn(email, temp, newPasscode = '615283') {
  const l = await call('POST', '/auth/login', null, { email, passcode: temp });
  if (!l.body?.passcodeChangeToken) return { login: l };
  const ch = await call('POST', '/auth/passcode-change/first-login', l.body.passcodeChangeToken, { newPasscode });
  let tok = ch.body?.accessToken;
  const yes = await call('POST', '/auth/legal-acceptance', tok, { acceptTerms: true });
  tok = yes.body?.accessToken ?? tok;
  return { tok, passcode: newPasscode, legal: yes.status };
}

const s = await makeSchool('notready', 'D7 Tablet', { tz: 'Pacific/Honolulu' });
const other = await makeSchool('notready', 'D7 Tablet Other', { tz: 'Pacific/Kiritimati' }); // staff there can add the person: 18 on its date
const O = () => s.owner.tok;
const waiver = await must('waiver', 'POST', `/schools/${s.id}/waivers`, O(), { title: 'Liability waiver', body: 'I understand that martial arts training carries a risk of injury.' });
const pack = await plan(s, { type: 'CLASS_PACK', title: 'Pack T', price: 5000, classesIncluded: 5, expiryDurationDays: 60 });
rec(A, 'setup', 'NOTE', { school: s.id, dob: DOB, kiritimatiToday: kiritimatiDay(0), honoluluToday: new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu' }).format(new Date()) });

async function act(tok, who) {
  const w = await call('POST', `/waivers/${waiver.id}/sign`, tok, { signerFullName: who, signatureText: who });
  const p = await call('POST', `/membership-plans/${pack.id}/purchase`, tok, {});
  return { waiver: w.status, waiverMsg: w.body?.error?.message?.slice(0, 80), purchase: p.status, purchaseCode: p.body?.error?.code ?? p.body?.outcome };
}
const refused = (r) => r.waiver === 403 && r.purchase === 403 && r.purchaseCode === 'UNDER_18_SELF';
const allowed = (r) => r.waiver < 300 && r.purchase < 300;

const sess = await must('front desk', 'POST', `/schools/${s.id}/front-desk/sessions`, O(), { branchId: s.branch.id });
const K = sess.sessionToken;
async function tablet(email, first) {
  const su = await call('POST', '/front-desk/kiosk/sign-ups', K, { kind: 'MEMBER', firstName: first, surname: 'Tab', dateOfBirth: DOB, email });
  const ap = su.status < 300 ? await call('POST', `/schools/${s.id}/sign-ups/${su.body.id}/approve`, O(), { branchId: s.branch.id }) : null;
  return { su, ap };
}

// T1
{
  const email = `tess.tab.${RUN}@d7.test`;
  const { su, ap } = await tablet(email, 'Tess');
  const f = ap?.body?.temporaryPasscode ? await firstSignIn(email, ap.body.temporaryPasscode) : {};
  const u = await db.user.findUnique({ where: { email } });
  const r = f.tok ? await act(f.tok, 'Tess Tab') : null;
  expect(A, 'T1 approved tablet sign-up, 18 in the earliest zone, 17 on the School date: waiver and purchase allowed', su.status < 300 && ap?.status < 300 && !!u?.signedUpOnTabletAt && r && allowed(r), { signUp: su.status, signUpErr: su.body?.error?.code, approve: ap?.status, accountCreated: ap?.body?.accountCreated, tabletAt: u?.signedUpOnTabletAt, legal: f.legal, r });
}
// T2
{
  const email = `max.man.${RUN}@d7.test`;
  const here = await call('POST', `/schools/${s.id}/students/add-manually`, O(), { firstName: 'Max', surname: 'Here', email: `x.${email}`, dateOfBirth: DOB, branchId: s.branch.id });
  const m = await call('POST', `/schools/${other.id}/students/add-manually`, other.owner.tok, { firstName: 'Max', surname: 'Man', email, dateOfBirth: DOB, branchId: other.branch.id });
  const f = m.body?.temporaryPasscode ? await firstSignIn(email, m.body.temporaryPasscode) : {};
  const j = f.tok ? await call('POST', `/schools/${s.id}/join`, f.tok, { branchId: s.branch.id }) : null;
  const l = f.tok ? await call('POST', '/auth/login', null, { email, passcode: f.passcode }) : null;
  const r = l?.body?.accessToken ? await act(l.body.accessToken, 'Max Man') : null;
  expect(A, 'T2 control: same birthday, account added by staff (at a School where it is 18), joins this School: refused here (the School\'s date decides)', here.status === 400 && m.status < 300 && r && refused(r), { addHere: here.status, addOther: m.status, err: m.body?.error?.message, join: j?.status, joinErr: j?.body?.error?.message, r });
}
// T3
{
  const email = `ivy.old.${RUN}@d7.test`;
  const m = await call('POST', `/schools/${other.id}/students/add-manually`, other.owner.tok, { firstName: 'Ivy', surname: 'Old', email, dateOfBirth: DOB, branchId: other.branch.id });
  const f = m.body?.temporaryPasscode ? await firstSignIn(email, m.body.temporaryPasscode) : {};
  const { su, ap } = await tablet(email, 'Ivy');
  const u = await db.user.findUnique({ where: { email } });
  // Invited: the member accepts by joining the School in the app.
  const j = f.tok ? await call('POST', `/schools/${s.id}/join`, f.tok, { branchId: s.branch.id }) : null;
  const f2 = f.tok ? await call('POST', '/auth/login', null, { email, passcode: f.passcode }) : null;
  const r = f2?.body?.accessToken ? await act(f2.body.accessToken, 'Ivy Old') : null;
  expect(A, 'T3 an existing staff-made account linked by a tablet sign-up keeps its status: not "signed up themselves", still refused', ap?.status < 300 && ap.body?.accountCreated === false && !u?.signedUpOnTabletAt && r && refused(r), { signUp: su.status, approve: ap?.status, accountCreated: ap?.body?.accountCreated, invited: ap?.body?.invited, tabletAt: u?.signedUpOnTabletAt, join: j?.status, joinErr: j?.body?.error?.message, r });
}
// T4
{
  const p = await signUp({ first: 'Sam', last: 'Self', dob: DOB });
  const { su, ap } = await tablet(p.email, 'Sam');
  const u = await db.user.findUnique({ where: { id: p.id } });
  const j = await call('POST', `/schools/${s.id}/join`, p.tok, { branchId: s.branch.id });
  const l = await call('POST', '/auth/login', null, { email: p.email, passcode: p.passcode });
  const r = await act(l.body?.accessToken, 'Sam Self');
  expect(A, 'T4 an existing self-signed-up account linked by a tablet sign-up keeps its status: allowed; not marked as a tablet account', ap?.status < 300 && ap.body?.accountCreated === false && !u?.signedUpOnTabletAt && allowed(r), { signUp: su.status, approve: ap?.status, accountCreated: ap?.body?.accountCreated, tabletAt: u?.signedUpOnTabletAt, join: j.status, r });
}
await call('POST', `/schools/${s.id}/front-desk/sessions/${sess.sessionId}/end`, O(), {});
saveOut('tablet-out.json');
await db.$disconnect();
process.exit(0);
