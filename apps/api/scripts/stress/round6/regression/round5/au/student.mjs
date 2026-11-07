// Round 5 AU: the Student app's flows through the endpoints apps/student/src calls.
//   CAST=../empty-cast.json node student.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { db, call, grant, tokenRca, checks, codes, randomUUID, Queue } from '../../round4/common.mjs';
const require = createRequire(new URL('../../../../../../package.json', import.meta.url));
const bcrypt = require('bcrypt');
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const { ok, save } = checks('student');
const info = (id, d) => ok(id, true, 'INFO ' + d);
const sid = A.schoolId;
const PASS = '975310';
const hash = await bcrypt.hash(PASS, 10);
const owner = tokenRca({ id: A.owner, email: 'o' }, [grant('SCHOOL_OWNER_MANAGER', sid)]);
const bruno = tokenRca({ id: A.coaches[0].id, email: 'b' }, [grant('INSTRUCTOR', sid, A.branches.syd)]);
const login = async (id) => {
  const u = await db.user.update({ where: { id }, data: { passcodeHash: hash, mustChangePasscode: false }, select: { email: true } });
  const r = await call('login', 'POST', '/auth/login', null, { email: u.email, passcode: PASS });
  if (r.status >= 300) throw new Error('login ' + id + ' ' + r.status + JSON.stringify(r.body));
  return r.body;
};
const pickAdult = (b, i, withM = true) => A.students.filter((s) => s.b === b && s.tag === 'adult' && (!withM || A.memberships[s.id]))[i];
const sy = await Promise.all([10, 11, 12, 13].map((i) => pickAdult('syd', 40 + i)).map(async (s) => ({ id: s.id, ...(await login(s.id)) })));

// ST1 sign-in and refresh rotation.
{
  const s = sy[0];
  const r1 = await call('st1', 'POST', '/auth/refresh', null, { refreshToken: s.refreshToken });
  const r2 = await call('st1', 'POST', '/auth/refresh', null, { refreshToken: s.refreshToken });
  ok('ST1 refresh token rotates: the same refresh token used twice is refused the second time', r1.status < 300 && r2.status === 401, `${r1.status} ${r2.status}`);
  if (r1.status < 300) s.accessToken = r1.body.accessToken;
  const after = await call('st1', 'POST', '/auth/refresh', null, { refreshToken: r1.body?.refreshToken });
  info('ST1b after reuse of an old refresh token, does the new one still work (family revoked?)', `${after.status}`);
  if (after.status < 300) s.accessToken = after.body.accessToken; else s.accessToken = (await login(s.id)).accessToken;
}

// ST2 home screens.
{
  const t = sy[1].accessToken;
  const me = await call('st2', 'GET', '/users/me', t);
  const ac = await call('st2', 'GET', `/academies/${sid}`, t);
  const tt = await call('st2', 'GET', `/academies/${sid}/timetable`, t);
  const cl = await call('st2', 'GET', `/schools/${sid}/classes?when=upcoming&limit=50`, t);
  info('ST2a /users/me, /academies/:id, /academies/:id/timetable, /schools/:id/classes', `${me.status} ${ac.status} ${tt.status} ${cl.status}; academy keys ${Object.keys(ac.body ?? {}).slice(0, 25)}`);
  const ttItems = tt.body?.items ?? tt.body?.slots ?? tt.body ?? [];
  const lhi = (Array.isArray(ttItems) ? ttItems : []).find((x) => /LHI Dawn/.test(x.title ?? ''));
  info('ST2b timetable row for the Lord Howe 01:45 Sunday slot as the student app gets it', JSON.stringify(lhi ?? ttItems).slice(0, 400));
  const clItems = cl.body?.items ?? [];
  const brs = new Set(clItems.map((c) => c.branchId));
  info('ST2c a Sydney student sees classes at Branches', `${[...brs].map((b) => Object.entries(A.branches).find(([, v]) => v === b)?.[0] ?? b)}`);
}

// ST3 book, double tap, cancel.
{
  const t = sy[2].accessToken;
  const r = await Promise.all(Array.from({ length: 8 }, () => call('st3', 'POST', `/classes/${A.classes.tomorrow}/book`, t, {})));
  const n = await db.booking.count({ where: { classId: A.classes.tomorrow, studentId: sy[2].id, status: 'UPCOMING' } });
  ok('ST3a eight taps on Book make one booking', n === 1, `${JSON.stringify(codes(r))} → ${n}`);
  const me = await call('st3', 'GET', '/bookings/me', t);
  const b = (me.body?.items ?? []).find((x) => x.classId === A.classes.tomorrow);
  ok('ST3b My bookings shows the class name, time and School (Decision 427 SP4)', b && b.classTitle && b.classStartsAt && b.schoolName, JSON.stringify(b ?? me.body).slice(0, 200));
  const c = await Promise.all(Array.from({ length: 5 }, () => call('st3', 'PATCH', `/bookings/${b?.id}/cancel`, t, {})));
  const after = await db.booking.findUnique({ where: { id: b.id }, select: { status: true } });
  ok('ST3c five taps on Cancel cancel once', after.status === 'CANCELLED' && c.filter((x) => x.status < 300).length === 1, `${JSON.stringify(codes(c))} ${after.status}`);
}

// ST4 waitlist and seat offer on the 2-place class.
{
  const tiny = A.classes.tiny;
  const [a, b, w] = sy.slice(0, 3);
  const r = await Promise.all([a, b].map((s) => call('st4', 'POST', `/classes/${tiny}/book`, s.accessToken, {})));
  const full = await call('st4', 'POST', `/classes/${tiny}/book`, w.accessToken, {});
  const wl = await call('st4', 'POST', `/classes/${tiny}/waitlist`, w.accessToken, {});
  const wl2 = await Promise.all(Array.from({ length: 4 }, () => call('st4', 'POST', `/classes/${tiny}/waitlist`, w.accessToken, {})));
  const mine = await call('st4', 'GET', '/waitlist/me', w.accessToken);
  ok('ST4a class full → join waitlist once (5 taps) → listed in My waitlist (Decision 427 SP3)', r.every((x) => x.status < 300) && full.status >= 400 && wl.status < 300 && (mine.body?.items ?? mine.body ?? []).length === 1, `book ${r.map((x) => x.status)}; full ${full.status} ${full.body?.error?.code}; wl ${wl.status} +${JSON.stringify(codes(wl2))}; me ${(mine.body?.items ?? mine.body ?? []).length}`);
  const ab = await db.booking.findFirst({ where: { classId: tiny, studentId: a.id, status: 'UPCOMING' } });
  const cancel = await call('st4', 'PATCH', `/bookings/${ab.id}/cancel`, a.accessToken, {});
  let entry;
  for (let i = 0; i < 20; i++) { entry = await db.waitlistEntry.findFirst({ where: { classId: tiny, studentId: w.id } }); if (entry?.status === 'NOTIFIED') break; await new Promise((r2) => setTimeout(r2, 1000)); }
  info('ST4b after a cancel, the waitlist entry', `cancel ${cancel.status}; entry ${entry?.status} claimBy ${entry?.claimDeadline ?? entry?.expiresAt ?? ''}`);
  const notes = await call('st4', 'GET', '/notifications/me', w.accessToken);
  const offer = (notes.body?.items ?? []).find((n) => /waitlist|spot|place|seat/i.test(JSON.stringify(n)));
  info('ST4c seat-offer notice', offer ? JSON.stringify(offer).slice(0, 300) : `none yet (${notes.status}, ${(notes.body?.items ?? []).length} notices)`);
  // Two claims at once from the same phone, and a claim by the wrong person.
  const wrong = await call('st4', 'POST', `/waitlist/${entry.id}/claim`, b.accessToken, {});
  const claims = await Promise.all(Array.from({ length: 4 }, () => call('st4', 'POST', `/waitlist/${entry.id}/claim`, w.accessToken, {})));
  const seats = await db.booking.count({ where: { classId: tiny, status: 'UPCOMING' } });
  ok('ST4d claim: the wrong person is refused; 4 taps give one seat; class stays at capacity 2', wrong.status >= 400 && claims.filter((x) => x.status < 300).length === 1 && seats === 2, `wrong ${wrong.status}; claims ${JSON.stringify(codes(claims))}; seats ${seats}`);
}

// ST5 buying a plan.
{
  const s = await (async () => { const x = A.students.find((y) => y.b === 'syd' && y.tag === 'adult' && !A.memberships[y.id] && !sy.some((z) => z.id === y.id)); return { id: x.id, ...(await login(x.id)) }; })();
  const hosted = await call('st5', 'POST', `/membership-plans/${A.plans['10-class pack']}/purchase`, s.accessToken, { useHostedCheckout: true });
  info('ST5a hosted Checkout for a A$250 10-class pack', `${hosted.status} ${JSON.stringify(hosted.body).slice(0, 220)}`);
  const calls = await fetch('http://localhost:12111/__calls').then((r) => r.json()).catch(() => []);
  const mine = (Array.isArray(calls) ? calls : calls.calls ?? []).filter((c) => JSON.stringify(c).includes(A.plans['10-class pack']) || JSON.stringify(c).includes(s.id)).slice(-3);
  info('ST5b what fake Stripe received for it', JSON.stringify(mine).slice(0, 600));
  const saved = await call('st5', 'POST', `/membership-plans/${A.plans['1 drop-in']}/purchase`, s.accessToken, { payWithSavedCard: true });
  info('ST5c saved-card purchase with no saved card', `${saved.status} ${JSON.stringify(saved.body).slice(0, 160)}`);
  const plain = await call('st5', 'POST', `/membership-plans/${A.plans['1 drop-in']}/purchase`, s.accessToken, {});
  info('ST5d plain purchase of the A$30.13 drop-in (fake Stripe declines amounts ending 13)', `${plain.status} ${JSON.stringify(plain.body).slice(0, 220)}`);
  const kidG = A.guardians.find((g) => g.kids.length >= 2);
  const gTok = (await login(kidG.id)).accessToken;
  const forKid = await call('st5', 'POST', `/membership-plans/${A.plans['Kids Unlimited']}/purchase`, gTok, { studentId: kidG.kids[0], useHostedCheckout: true });
  const otherKid = A.guardians.find((g) => g.id !== kidG.id).kids[0];
  const forOther = await call('st5', 'POST', `/membership-plans/${A.plans['Kids Unlimited']}/purchase`, gTok, { studentId: otherKid, useHostedCheckout: true });
  ok('ST5e a parent buys for their own child, not for someone else\'s', forKid.status < 300 && forOther.status >= 400, `${forKid.status} ${JSON.stringify(forKid.body).slice(0, 100)}; other ${forOther.status}`);
}

// ST6 waivers: adult, Guardian for a child, 17-year-old, 18 yesterday, 18 today in Sydney.
{
  const w = await call('st6', 'POST', `/schools/${sid}/waivers`, owner, { title: 'Liability waiver (NSW)', body: 'I accept the risks of martial arts training. Recreational activity under the Civil Liability Act 2002 (NSW) s5L. ✔️ ' + 'x'.repeat(200) });
  info('ST6a owner creates a waiver', `${w.status} ${w.body?.id ?? JSON.stringify(w.body).slice(0, 120)}`);
  const wid = w.body?.id;
  const adult = sy[3];
  const s1 = await Promise.all(Array.from({ length: 5 }, () => call('st6', 'POST', `/waivers/${wid}/sign`, adult.accessToken, { signerFullName: 'Adult Signer', signatureText: 'Adult Signer' })));
  const n = await db.waiverSignature.count({ where: { waiverId: wid, studentId: adult.id } });
  ok('ST6b an adult signs (5 taps → one signature)', n === 1, `${JSON.stringify(codes(s1))} → ${n}`);
  const fam = A.guardians.find((g) => g.kids.includes(A.special.turning18)) ?? A.guardians[0];
  const gTok = (await login(fam.id)).accessToken;
  const kid17 = await login(A.special.turning18);
  const self17 = await call('st6', 'POST', `/waivers/${wid}/sign`, kid17.accessToken, { signerFullName: 'Ruby', signatureText: 'Ruby' });
  const g17 = await call('st6', 'POST', `/waivers/${wid}/sign`, gTok, { studentId: A.special.turning18, signerFullName: 'Parent', signatureText: 'Parent' });
  ok('ST6c a 17-year-old (18 in 3 days) cannot sign; her Guardian can', self17.status === 403 && g17.status < 300, `self ${self17.status}; guardian ${g17.status} ${JSON.stringify(g17.body).slice(0, 100)}`);
  const stranger = A.guardians.find((g) => !g.kids.includes(A.special.turning18) && g.id !== fam.id);
  const sTok = (await login(stranger.id)).accessToken;
  const gx = await call('st6', 'POST', `/waivers/${wid}/sign`, sTok, { studentId: fam.kids[fam.kids.length - 1], signerFullName: 'Not Parent', signatureText: 'x' });
  ok('ST6d another child\'s parent cannot sign for this child', gx.status >= 400, `${gx.status}`);
  const max = await login(A.special.turned18);
  const selfMax = await call('st6', 'POST', `/waivers/${wid}/sign`, max.accessToken, { signerFullName: 'Max Just-Adult', signatureText: 'Max' });
  ok('ST6e someone who turned 18 yesterday signs themself', selfMax.status < 300, `${selfMax.status} ${JSON.stringify(selfMax.body).slice(0, 120)}`);
  // 18th birthday today in Sydney (the School's zone) but still yesterday in UTC.
  const sydToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  const utcToday = new Date().toISOString().slice(0, 10);
  const bday = new Date(`${Number(sydToday.slice(0, 4)) - 18}${sydToday.slice(4)}T00:00:00Z`);
  const u = await db.user.create({ data: { id: randomUUID(), email: `r5-au-bday-${Date.now()}@stress.test`, firstName: 'Birthday', surname: 'Today', passcodeHash: hash, dateOfBirth: bday, phoneVerifiedAt: new Date(), language: 'en-GB', currency: 'AUD' } });
  await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: sid, branchId: A.branches.syd } });
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: sid, studentId: u.id, branchId: A.branches.syd } });
  const bt = (await call('st6', 'POST', '/auth/login', null, { email: u.email, passcode: PASS })).body.accessToken;
  const selfB = await call('st6', 'POST', `/waivers/${wid}/sign`, bt, { signerFullName: 'Birthday Today', signatureText: 'BT' });
  ok(`ST6f born ${bday.toISOString().slice(0, 10)}: 18 today in Sydney (${sydToday}) — may sign their own waiver`, sydToday === utcToday || selfB.status < 300, `Sydney date ${sydToday}, UTC date ${utcToday}; sign ${selfB.status} ${JSON.stringify(selfB.body).slice(0, 160)}`);
  fs.writeFileSync(new URL('./bday-user.json', import.meta.url), JSON.stringify({ id: u.id, email: u.email, dob: bday }));
  const minorsW = await call('st6', 'GET', `/guardians/me/minors/${A.special.turning18}/waivers`, gTok);
  info('ST6g Guardian\'s view of the child\'s waivers (Decision 428)', `${minorsW.status} ${JSON.stringify(minorsW.body).slice(0, 200)}`);
}

// ST7 check-in by class code at Lord Howe, and the app QR.
{
  const lhiS = A.students.find((s) => s.b === 'lhi' && s.tag === 'adult' && A.memberships[s.id] && !sy.some((z) => z.id === s.id));
  const t = (await login(lhiS.id)).accessToken;
  const bk = await call('st7', 'POST', `/classes/${A.classes.nowLhi}/book`, t, {});
  const tom = tokenRca({ id: A.coaches.find((c) => c.name === 'Tom').id, email: 't' }, [grant('INSTRUCTOR', sid, A.branches.lhi)]);
  const q = await call('st7', 'GET', `/classes/${A.classes.nowLhi}/qr-token`, tom);
  const wrongCode = await call('st7', 'POST', '/attendance/code', t, { classId: A.classes.nowLhi, code: '000000' });
  const code = await call('st7', 'POST', '/attendance/code', t, { classId: A.classes.nowLhi, code: q.body?.code });
  ok('ST7a a Lord Howe member checks in with the class code the coach shows (wrong code refused)', (bk.status < 300 || bk.status === 409) && wrongCode.status >= 400 && code.status < 300, `book ${bk.status}; wrong ${wrongCode.status}; code ${code.status} ${JSON.stringify(code.body).slice(0, 120)}`);
  const qr = await call('st7', 'GET', '/attendance/my-qr-token', t);
  info('ST7b my QR token', `${qr.status} expires ${qr.body?.expiresAt}`);
}

// ST8 Kid Mode.
{
  const fam = A.guardians.find((g) => g.kids.some((k) => A.memberships[k]));
  const kid = fam.kids.find((k) => A.memberships[k]);
  const kidB = A.students.find((s) => s.id === kid).b;
  const gTok = (await login(fam.id)).accessToken;
  const del = await call('st8', 'POST', `/guardians/me/minors/${kid}/booking-delegation`, gTok, {});
  const km = await call('st8', 'POST', `/guardians/me/minors/${kid}/kid-mode-token`, gTok, {});
  const kt = km.body?.accessToken ?? km.body?.token ?? km.body?.kidModeToken;
  info('ST8a delegation + kid-mode token', `${del.status} ${km.status} keys ${Object.keys(km.body ?? {})}`);
  const cls = await db.class.findFirst({ where: { schoolId: sid, branchId: A.branches[kidB], startDate: { gt: new Date(Date.now() + 86400e3) }, cancelledAt: null, timetableSlotId: { not: null } }, orderBy: { startDate: 'asc' } });
  const b = await call('st8', 'POST', `/classes/${cls.id}/book`, kt, { studentId: kid });
  const other = fam.kids.find((k) => k !== kid) ?? A.students.find((s) => s.tag === 'adult').id;
  const r = await Promise.all([
    call('st8', 'POST', `/classes/${cls.id}/book`, kt, { studentId: other }),
    call('st8', 'POST', `/classes/${cls.id}/book`, kt, {}),
    call('st8', 'GET', '/notifications/me', kt),
    call('st8', 'POST', `/membership-plans/${A.plans['Kids Unlimited']}/purchase`, kt, { studentId: kid }),
    call('st8', 'PATCH', `/bookings/${b.body?.id}/cancel`, kt, { studentId: kid }),
    call('st8', 'POST', `/classes/${cls.id}/book`, kt, { studentId: kid, overrideReason: 'x' }),
  ]);
  ok('ST8b Kid Mode books the child; everything else is refused', b.status < 300 && r.every((x) => x.status >= 400), `book ${b.status} ${JSON.stringify(b.body).slice(0, 100)}; others ${r.map((x) => x.status)}`);
  const pend = await call('st8', 'GET', '/guardians/me/bookings-pending-review', gTok);
  info('ST8c parent sees the Kid Mode booking for review', `${pend.status} ${JSON.stringify(pend.body).slice(0, 160)}`);
}

// ST9 notifications go to the right people: a class cancellation reaches booked students and their parents only.
{
  const fam = A.guardians.find((g) => g.kids.some((k) => A.memberships[k] && A.students.find((s) => s.id === k).b === 'syd'));
  const kid = fam.kids.find((k) => A.memberships[k] && A.students.find((s) => s.id === k).b === 'syd');
  const gTok = (await login(fam.id)).accessToken;
  const cls = await call('st9', 'POST', `/schools/${sid}/classes`, owner, { branchId: A.branches.syd, instructorId: A.coaches[0].id, title: 'Kids sparring (to cancel)', styles: [{ disciplineId: A.bjj, classType: null }], startDate: new Date(Date.now() + 2 * 86400e3).toISOString(), endDate: new Date(Date.now() + 2 * 86400e3 + 3600e3).toISOString(), capacity: 10, membershipInclusion: true });
  const gb = await call('st9', 'POST', `/classes/${cls.body.id}/book`, gTok, { studentId: kid });
  const can = await call('st9', 'POST', `/classes/${cls.body.id}/cancel`, owner, { reason: 'Coach at the State titles' });
  await new Promise((r) => setTimeout(r, 6000));
  const gN = await call('st9', 'GET', '/notifications/me', gTok);
  const hit = (gN.body?.items ?? []).filter((n) => JSON.stringify(n).includes('State titles') || JSON.stringify(n).includes('Kids sparring'));
  const strangerG = A.guardians.find((g) => g.id !== fam.id && g.kids.length);
  const sN = await call('st9', 'GET', '/notifications/me', (await login(strangerG.id)).accessToken);
  const leak = (sN.body?.items ?? []).filter((n) => JSON.stringify(n).includes('Kids sparring'));
  ok('ST9 the cancelled class notice reaches the child\'s parent, and not another parent', gb.status < 300 && can.status < 300 && hit.length >= 1 && leak.length === 0, `book ${gb.status} ${JSON.stringify(gb.body).slice(0, 80)}; cancel ${can.status}; parent ${hit.length} ${JSON.stringify(hit[0] ?? {}).slice(0, 200)}; stranger ${leak.length}`);
}

save();
await db.$disconnect();
