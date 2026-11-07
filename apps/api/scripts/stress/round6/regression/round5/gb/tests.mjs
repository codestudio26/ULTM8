// Round 5 GB: minors and Guardians. Runs against gb-cast.json (seed.mjs).
// Every request/response is kept in tests-evidence.json for the findings.
//   ONLY=T1,T2   run some sections
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca, pool } from '../../round4/common.mjs';

const C = JSON.parse(fs.readFileSync(new URL('./gb-cast.json', import.meta.url)));
const U = C.users; const A = C.schoolA; const B = C.schoolB;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const ev = [];
const res = [];
const short = (b) => { const s = JSON.stringify(b); return s && s.length > 400 ? s.slice(0, 400) + '…' : s; };
async function req(id, method, path, tok, body, headers) {
  const r = await call(id, method, path, tok, body, headers);
  ev.push({ id, req: `${method} ${path}`, body, status: r.status, resp: short(r.body) });
  return r;
}
const ok = (id, pass, detail) => { res.push({ id, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? ' — ' + detail : ''}`); };
const on = (s) => !ONLY || ONLY.includes(s);
const g = (u) => tokenRca(u, []);
const tOwner = tokenRca(U.owner, [grant('SCHOOL_OWNER_MANAGER', A)]);
const tStaffLev = tokenRca(U.staffLev, [grant('BRANCH_STAFF', A, C.branches.lev)]);
const tStaffDid = tokenRca(U.staffDid, [grant('BRANCH_STAFF', A, C.branches.did)]);
const tInstrLev = tokenRca(U.instrLev, [grant('INSTRUCTOR', A, C.branches.lev)]);
const tInstrDid = tokenRca(U.instrDid, [grant('INSTRUCTOR', A, C.branches.did)]);
const tOwnerB = tokenRca(U.ownerB, [grant('SCHOOL_OWNER_MANAGER', B)]);
const tPatrick = tokenRca(U.patrick, [grant('STUDENT', A, C.branches.lev)]);
const tLiam = tokenRca(U.liam, [grant('STUDENT', A, C.branches.lev)]);
const ymd = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (y, extraDays = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); d.setUTCDate(d.getUTCDate() + extraDays); return d; };

// ---- T1: createMinor input validation ----
// Round 6 adaptation (Decision 441 item 5): "Waiver must be signed before booking or
// check-in" is on by default; these family tests were written for the per-class rule
// only, so it is switched off at School A for the run (WAIVER_RULE=on keeps it).
if (process.env.WAIVER_RULE !== 'on') {
  const g0 = await call('setup', 'GET', `/schools/${A}/check-in-rules`, tOwner);
  const p0 = await call('setup', 'PUT', `/schools/${A}/check-in-rules`, tOwner, { ...g0.body, requireWaiver: false });
  console.log('waiver rule off at School A:', p0.status);
}
if (on('T1')) {
  const cases = [
    ['future DOB', { firstName: 'Fut', surname: 'Ure', dateOfBirth: '2099-01-01' }],
    ['DOB 1900', { firstName: 'Old', surname: 'Child', dateOfBirth: '1900-01-01' }],
    ['adult DOB (40y)', { firstName: 'Grown', surname: 'Up', dateOfBirth: ymd(yearsAgo(40)) }],
    ['spaces-only name', { firstName: '   ', surname: '   ', dateOfBirth: ymd(yearsAgo(8)) }],
    ['impossible date 2017-02-30', { firstName: 'Feb', surname: 'Thirty', dateOfBirth: '2017-02-30' }],
  ];
  for (const [label, body] of cases) {
    const r = await req(`T1 ${label}`, 'POST', '/guardians/me/minors', g(U.ann), body);
    ok(`T1 createMinor refuses ${label}`, r.status === 400, `got ${r.status} ${short(r.body)}`);
  }
}

// ---- T2: a Guardian who also trains (Patrick) acts for his son Oisín ----
if (on('T2')) {
  const ctl = await req('T2 control Máire books Aoife', 'POST', `/classes/${C.classes.open1}/book`, g(U.maire), { studentId: U.aoife.id });
  ok('T2 control: plain Guardian books child', ctl.status === 201, `${ctl.status} ${short(ctl.body)}`);
  const r1 = await req('T2 Patrick books Oisín (student token)', 'POST', `/classes/${C.classes.open1}/book`, tPatrick, { studentId: U.oisin.id });
  ok('T2 Guardian-who-trains books child (token with STUDENT grant)', r1.status === 201, `${r1.status} ${short(r1.body)}`);
  const r1b = await req('T2 Patrick books Oisín (no-grant token)', 'POST', `/classes/${C.classes.open2}/book`, g(U.patrick), { studentId: U.oisin.id });
  ok('T2 Guardian-who-trains books child (token without grants)', r1b.status === 201, `${r1b.status} ${short(r1b.body)}`);
  const r2 = await req('T2 Patrick signs waiver for Oisín', 'POST', `/waivers/${C.waiverId}/sign`, tPatrick, { studentId: U.oisin.id, signerFullName: 'Patrick Byrne', signatureText: 'Patrick Byrne' });
  ok('T2 Guardian-who-trains signs child waiver', r2.status === 201, `${r2.status} ${short(r2.body)}`);
  const r3 = await req('T2 Patrick waitlists Oisín', 'POST', `/classes/${C.classes.open3}/waitlist`, tPatrick, { studentId: U.oisin.id });
  ok('T2 Guardian-who-trains waitlist path reaches business rule (not 403)', r3.status !== 403, `${r3.status} ${short(r3.body)}`);
  const r4 = await req('T2 Patrick buys plan for Oisín', 'POST', `/membership-plans/${C.plans['10-class pack']}/purchase`, tPatrick, { studentId: U.oisin.id, useHostedCheckout: true });
  ok('T2 Guardian-who-trains buys child plan', r4.status === 201, `${r4.status} ${short(r4.body)}`);
  // Instructor (Didsbury) who is a parent books his son at Levenshulme.
  const r5 = await req('T2 Instructor-parent books son', 'POST', `/classes/${C.classes.open1}/book`, tInstrDid, { studentId: U.ruairi.id });
  ok('T2 Instructor-parent books own child at another branch', r5.status === 201, `${r5.status} ${short(r5.body)}`);
  const r6 = await req('T2 Instructor-parent signs son waiver', 'POST', `/waivers/${C.waiverId}/sign`, tInstrDid, { studentId: U.ruairi.id, signerFullName: 'Kieran Ó Súilleabháin', signatureText: 'Kieran Ó Súilleabháin' });
  ok('T2 Instructor-parent signs own child waiver', r6.status === 201, `${r6.status} ${short(r6.body)}`);
}

// ---- T3: Kid Mode ----
if (on('T3')) {
  const d1 = await req('T3 grant delegation Aoife', 'POST', `/guardians/me/minors/${U.aoife.id}/booking-delegation`, g(U.maire));
  const m1 = await req('T3 mint token Aoife', 'POST', `/guardians/me/minors/${U.aoife.id}/kid-mode-token`, g(U.maire));
  const m2 = await req('T3 mint token Cian (no delegation)', 'POST', `/guardians/me/minors/${U.cian.id}/kid-mode-token`, g(U.maire));
  ok('T3 mint for delegated child only', m1.status === 201 && m2.status === 403, `${m1.status}/${m2.status}`);
  const kt = m1.body?.accessToken;
  const b1 = await req('T3 kid books Aoife', 'POST', `/classes/${C.classes.open2}/book`, kt, { studentId: U.aoife.id });
  ok('T3 Kid Mode books own credit', b1.status === 201 && b1.body?.bookedViaKidMode === true, `${b1.status} ${short(b1.body)}`);
  const probes = [
    ['book sibling', 'POST', `/classes/${C.classes.open2}/book`, { studentId: U.cian.id }],
    ['book with override', 'POST', `/classes/${C.classes.open3}/book`, { studentId: U.aoife.id, overrideReason: 'x' }],
    ['list minors', 'GET', '/guardians/me/minors'],
    ['purchase', 'POST', `/membership-plans/${C.plans['10-class pack']}/purchase`, { studentId: U.aoife.id, useHostedCheckout: true }],
    ['waitlist', 'POST', `/classes/${C.classes.open3}/waitlist`, { studentId: U.aoife.id }],
    ['cancel', 'PATCH', `/bookings/${b1.body?.id}/cancel`, { studentId: U.aoife.id }],
    ['sign waiver', 'POST', `/waivers/${C.waiverId}/sign`, { studentId: U.aoife.id, signerFullName: 'Aoife', signatureText: 'Aoife' }],
    ['mint another token', 'POST', `/guardians/me/minors/${U.aoife.id}/kid-mode-token`],
    ['notifications', 'GET', '/notifications/me'],
    ['book trailing slash', 'POST', `/classes/${C.classes.open3}/book/`, { studentId: U.aoife.id }],
    ['book with query', 'POST', `/classes/${C.classes.open3}/book?x=1`, { studentId: U.aoife.id }],
  ];
  for (const [label, m, p, body] of probes) {
    const r = await req(`T3 kid token: ${label}`, m, p, kt, body);
    ok(`T3 Kid Mode token refused: ${label}`, r.status === 403 || (label.startsWith('book with query') && r.status !== 201) || r.status === 404, `${r.status} ${short(r.body)}`);
  }
  // Guests in Kid Mode.
  const gst = await req('T3 kid books with guest', 'POST', `/classes/${C.classes.open3}/book`, kt, { studentId: U.aoife.id, attendeeMembershipIds: [randomUUID()] });
  ok('T3 no guests in Kid Mode', gst.status === 403, `${gst.status} ${short(gst.body)}`);
  // Race: 8 Kid Mode bookings at once into the same class.
  const race = await Promise.all(Array.from({ length: 8 }, () => call('T3 race', 'POST', `/classes/${C.classes.open3}/book`, kt, { studentId: U.aoife.id })));
  const codes = race.map((r) => r.status).sort().join(',');
  ok('T3 Kid Mode 8 parallel bookings → one', race.filter((r) => r.status === 201).length === 1, codes);
  // Withdraw delegation → review queue → token refused.
  const w = await req('T3 withdraw delegation', 'PATCH', `/guardians/me/booking-delegation/${d1.body?.id}/withdraw`, g(U.maire));
  const after = await req('T3 kid token after withdraw', 'POST', `/classes/${C.classes.tiny}/book`, kt, { studentId: U.aoife.id });
  const pend = await req('T3 pending review', 'GET', '/guardians/me/bookings-pending-review', g(U.maire));
  ok('T3 withdraw → token dead, bookings to review', w.status === 200 && after.status === 403 && (pend.body?.items || []).length >= 1, `${w.status}/${after.status}/${(pend.body?.items || []).length}`);
  // Another parent can't confirm Máire's review item.
  const it = (pend.body?.items || [])[0];
  if (it) {
    const x = await req('T3 Patrick confirms Máire review', 'PATCH', `/guardians/me/bookings-pending-review/${it.id}/confirm`, g(U.patrick), { studentId: it.studentId });
    ok('T3 other parent cannot confirm review', x.status === 403, `${x.status}`);
  }
  // Patrick (Guardian who trains) in Kid Mode.
  await req('T3 Patrick delegation', 'POST', `/guardians/me/minors/${U.oisin.id}/booking-delegation`, g(U.patrick));
  const pm = await req('T3 Patrick mint', 'POST', `/guardians/me/minors/${U.oisin.id}/kid-mode-token`, g(U.patrick));
  const pb = await req('T3 Oisín Kid Mode books', 'POST', `/classes/${C.classes.open3}/book`, pm.body?.accessToken, { studentId: U.oisin.id });
  ok('T3 Kid Mode works for a Guardian who also trains', pb.status === 201, `${pb.status} ${short(pb.body)}`);
}

// ---- T4: privacy of a child's data ----
if (on('T4')) {
  const prof = async (label, tok, sid, school = A) => req(`T4 ${label}`, 'GET', `/schools/${school}/students/${sid}/profile`, tok);
  const lev = await prof('Lev staff reads Aoife', tStaffLev, U.aoife.id);
  const did = await prof('Did staff reads Aoife', tStaffDid, U.aoife.id);
  const idid = await prof('Did instructor reads Aoife', tInstrDid, U.aoife.id);
  const bo = await prof('School B owner reads Aoife at A', tOwnerB, U.aoife.id);
  ok('T4 Branch Staff sees own branch child', lev.status === 200, `${lev.status}`);
  ok('T4 other-branch staff/instructor cannot read child', did.status >= 403 && idid.status >= 403, `${did.status}/${idid.status}`);
  ok('T4 other School owner cannot read child at A', bo.status >= 403, `${bo.status}`);
  const gl = await req('T4 Did staff reads Aoife guardians', 'GET', `/schools/${A}/students/${U.aoife.id}/guardians`, tStaffDid);
  ok('T4 other-branch staff cannot read child guardians', gl.status >= 403, `${gl.status}`);
  // Other parents and Guardian reads.
  for (const [p, label] of [[`/guardians/me/minors/${U.aoife.id}/bookings`, 'bookings'], [`/guardians/me/minors/${U.aoife.id}/waivers`, 'waivers'], [`/guardians/me/minors/${U.aoife.id}/schools`, 'schools'], [`/guardians/me/minors/${U.aoife.id}/friend-passes?schoolId=${A}`, 'friend-passes'], [`/students/${U.aoife.id}/medical-info`, 'medical presence']]) {
    const r = await req(`T4 Patrick reads Aoife ${label}`, 'GET', p, g(U.patrick));
    ok(`T4 another parent cannot read child ${label}`, r.status === 403 || r.status === 404, `${r.status} ${short(r.body)}`);
  }
  // Medical info (Niamh): who sees the text.
  const med = async (label, tok) => req(`T4 medical ${label}`, 'GET', `/schools/${A}/students/${U.niamh.id}/medical-info`, tok);
  const mo = await med('owner', tOwner); const ms = await med('Lev staff (no switch)', tStaffLev); const mi = await med('Lev instructor', tInstrLev); const md = await med('Did staff', tStaffDid); const mb = await med('School B owner', tOwnerB);
  const mm = await med('mum', g(U.mum));
  ok('T4 medical: owner reads', mo.status === 200 && /Asthma/.test(JSON.stringify(mo.body)), `${mo.status}`);
  ok('T4 medical: staff without switch, instructor, other branch, other School, parent (staff view) refused', [ms, mi, md, mb, mm].every((r) => r.status >= 403), [ms, mi, md, mb, mm].map((r) => r.status).join('/'));
  const mp = await req('T4 Mum medical presence', 'GET', `/students/${U.niamh.id}/medical-info`, g(U.mum));
  ok('T4 medical presence for Guardian', mp.status === 200, `${mp.status} ${short(mp.body)}`);
  // School B sees Aoife (enrolled there) but not her A data.
  const ws = await req('T4 School B owner reads Aoife waiver-status at A', 'GET', `/students/${U.aoife.id}/waiver-status?schoolId=${A}`, tOwnerB);
  ok('T4 School B cannot read A waiver status', ws.status >= 403, `${ws.status}`);
  const bl = await req('T4 School B student list', 'GET', `/schools/${B}/students?limit=100`, tOwnerB);
  const blTxt = JSON.stringify(bl.body);
  ok('T4 School B list shows only its own (no Cian/Saoirse siblings)', bl.status === 200 && !blTxt.includes(U.cian.id) && !blTxt.includes(U.saoirse.id), `${bl.status}`);
  const bg = await req('T4 School B reads Aoife guardians', 'GET', `/schools/${B}/students/${U.aoife.id}/guardians`, tOwnerB);
  ok('T4 School B sees Aoife guardian (she is enrolled there)', bg.status === 200, `${bg.status} ${short(bg.body)}`);
  // Student roster by other-branch staff: no Levenshulme kids.
  const rl = await req('T4 Did staff roster', 'GET', `/schools/${A}/students?limit=500`, tStaffDid);
  const rlTxt = JSON.stringify(rl.body);
  ok('T4 Did staff roster excludes Levenshulme children', rl.status === 200 && !rlTxt.includes(U.aoife.id) && !rlTxt.includes(U.niamh.id), `${rl.status}`);
}

// ---- T5: the 18th birthday ----
if (on('T5')) {
  const ws = await req('T5 Ann signs waiver for Ronan (18 yesterday)', 'POST', `/waivers/${C.waiverId}/sign`, g(U.ann), { studentId: U.ronan.id, signerFullName: 'Ann Murphy', signatureText: 'Ann Murphy' });
  ok('T5 parent cannot sign for an adult (18 yesterday)', ws.status === 403 || ws.status === 400, `${ws.status} ${short(ws.body)}`);
  const wc = await req('T5 Ann signs waiver for Ciara (18 tomorrow)', 'POST', `/waivers/${C.waiverId}/sign`, g(U.ann), { studentId: U.ciara.id, signerFullName: 'Ann Murphy', signatureText: 'Ann Murphy' });
  ok('T5 parent signs for 17-year-old', wc.status === 201, `${wc.status}`);
  const pr = await req('T5 Ann buys plan for Ronan', 'POST', `/membership-plans/${C.plans['Single class £9.99']}/purchase`, g(U.ann), { studentId: U.ronan.id, useHostedCheckout: true });
  ok('T5 parent cannot buy for an adult', pr.status >= 400, `${pr.status} ${short(pr.body)}`);
  const bk = await req('T5 Ann books Ronan', 'POST', `/classes/${C.classes.open1}/book`, g(U.ann), { studentId: U.ronan.id });
  ok('T5 parent cannot book for an adult', bk.status >= 400, `${bk.status}`);
  const ml = await req('T5 Ann reads Ronan medical presence', 'GET', `/students/${U.ronan.id}/medical-info`, g(U.ann));
  ok('T5 parent cannot manage adult medical consent', ml.status >= 403, `${ml.status}`);
  const sig = await db.waiverSignature.findFirst({ where: { studentId: U.ciara.id, status: 'SIGNED' }, select: { studentMajorityDate: true, signedDate: true, signedByGuardianId: true } }).catch((e) => ({ err: e.message }));
  ev.push({ id: 'T5 Ciara signature row', db: sig });
  // DOB change across 18 (Decision 342): Did staff makes Ciara (17) an adult.
  const cross = await req('T5 Did staff makes Ciara adult', 'PATCH', `/schools/${A}/students/${U.ciara.id}/profile`, tStaffDid, { dateOfBirth: ymd(yearsAgo(18, -2)) });
  ok('T5 staff cannot cross 18 (Decision 342)', cross.status === 403, `${cross.status} ${short(cross.body)}`);
  const same = await req('T5 Did staff corrects Ciara same side', 'PATCH', `/schools/${A}/students/${U.ciara.id}/profile`, tStaffDid, { dateOfBirth: ymd(yearsAgo(18, 2)) });
  ok('T5 staff can correct same side', same.status === 200, `${same.status} ${short(same.body)}`);
  // Guardian creating a "minor" who is already 18 today.
  const c18 = await req('T5 createMinor 18 today', 'POST', '/guardians/me/minors', g(U.ann), { firstName: 'Eighteen', surname: 'Today', dateOfBirth: ymd(yearsAgo(18)) });
  ok('T5 createMinor refuses an 18-year-old', c18.status === 400, `${c18.status}`);
}

// ---- T6: child with no Guardian (Liam, 10, own login) ----
if (on('T6')) {
  const s = await req('T6 Liam signs waiver', 'POST', `/waivers/${C.waiverId}/sign`, tLiam, { signerFullName: 'Liam Walsh', signatureText: 'Liam Walsh' });
  ok('T6 10-year-old cannot self-sign', s.status === 403, `${s.status} ${short(s.body)}`);
  const p = await req('T6 Liam buys plan', 'POST', `/membership-plans/${C.plans['Juniors monthly']}/purchase`, tLiam, { useHostedCheckout: true });
  ok('T6 10-year-old cannot self-purchase (Decision 67)', p.status === 403 || p.status === 400, `${p.status} ${short(p.body)}`);
  const p2 = await req('T6 Liam buys pack', 'POST', `/membership-plans/${C.plans['10-class pack']}/purchase`, tLiam, {});
  ok('T6 10-year-old cannot self-purchase pack (PaymentIntent path)', p2.status === 403 || p2.status === 400, `${p2.status} ${short(p2.body)}`);
  const m = await req('T6 Liam joins School B with medical', 'POST', `/schools/${B}/join`, tLiam, { branchId: C.branches.bMain, medicalInfo: 'ADHD', medicalConsent: true });
  ok('T6 child cannot self-consent medical', m.status === 403 || m.status === 400, `${m.status} ${short(m.body)}`);
  const ac = await req('T6 owner adds child with Liam as Guardian', 'POST', `/schools/${A}/students/add-child-manually`, tOwner, { child: { firstName: 'Baby', surname: 'Walsh', dateOfBirth: ymd(yearsAgo(3)) }, guardian: { email: U.liam.email, firstName: 'Liam', surname: 'Walsh' }, branchId: C.branches.lev });
  ok('T6 a 10-year-old cannot be named Guardian', ac.status === 400, `${ac.status} ${short(ac.body)}`);
  const cm = await req('T6 Liam creates a minor', 'POST', '/guardians/me/minors', tLiam, { firstName: 'Tiny', surname: 'Walsh', dateOfBirth: ymd(yearsAgo(2)) });
  ok('T6 a 10-year-old cannot become a Guardian via the app', cm.status === 403 || cm.status === 400, `${cm.status} ${short(cm.body)}`);
}

// ---- T7: divorced parents: adding Dad as second Guardian of Niamh ----
if (on('T7')) {
  const r = await req('T7 owner adds Niamh with Dad email', 'POST', `/schools/${A}/students/add-child-manually`, tOwner, { child: { firstName: 'Niamh', surname: 'Kelly', dateOfBirth: '2016-02-29' }, guardian: { email: U.dad.email, firstName: 'Declan', surname: 'Kelly' }, branchId: C.branches.lev });
  ev.push({ id: 'T7 invite', status: r.status });
  const inv = await req('T7 Dad lists invites', 'GET', '/child-invites/me', g(U.dad));
  const id = inv.body?.items?.[0]?.id;
  const acc = id ? await req('T7 Dad accepts', 'POST', `/child-invites/${id}/accept`, g(U.dad)) : { status: 0, body: null };
  const niamhs = await db.$queryRawUnsafe(`select u.id, u."firstName", u.surname, u."dateOfBirth"::date as dob, (select count(*) from "GuardianLink" gl where gl."studentId"=u.id and gl."revokedAt" is null)::int as guardians from "User" u join "RoleGrant" rg on rg."userId"=u.id and rg."schoolId"=$1 and rg.role='STUDENT' and rg."revokedAt" is null where u."firstName"='Niamh' and u.surname='Kelly'`, A);
  ev.push({ id: 'T7 Niamh rows at School A', db: niamhs });
  ok('T7 second Guardian links to the same child (no duplicate)', niamhs.length === 1 && niamhs[0].guardians === 2, `accept ${acc.status}; Niamh rows=${niamhs.length} ${JSON.stringify(niamhs)}`);
  // Mum's view vs Dad's: does Dad see Niamh's medical info presence / waivers?
  const dm = await req('T7 Dad minors', 'GET', '/guardians/me/minors', g(U.dad));
  ev.push({ id: 'T7 Dad minors', resp: short(dm.body) });
  // A Guardian removing themselves / an owner removing a parent: any route?
  for (const [m, p] of [['DELETE', `/guardians/me/minors/${U.niamh.id}`], ['POST', `/guardians/me/minors/${U.niamh.id}/unlink`], ['DELETE', `/schools/${A}/students/${U.niamh.id}/guardians/${U.mum.id}`]]) {
    const x = await req(`T7 remove link ${m} ${p}`, m, p, m === 'DELETE' && p.startsWith('/schools') ? tOwner : g(U.mum));
    ev.push({ id: 'T7 unlink probe', status: x.status });
  }
}

// ---- T8: notifications to the right family ----
if (on('T8')) {
  // Book Niamh and Cian into open2 (Aoife and Oisín already in), then a class broadcast.
  await req('T8 Mum books Niamh', 'POST', `/classes/${C.classes.open2}/book`, g(U.mum), { studentId: U.niamh.id });
  await req('T8 Máire books Cian', 'POST', `/classes/${C.classes.open2}/book`, g(U.maire), { studentId: U.cian.id });
  const tag = `Kata moved ${randomUUID().slice(0, 6)}`;
  const b = await req('T8 class broadcast', 'POST', `/schools/${A}/notifications/broadcast`, tOwner, { title: tag, body: 'Family kata moves to the big hall.', audience: 'CLASS', classId: C.classes.open2, classAudience: ['BOOKED'] });
  ok('T8 broadcast accepted', b.status === 201, `${b.status} ${short(b.body)}`);
  const ids = { maire: U.maire.id, mum: U.mum.id, dad: U.dad.id, patrick: U.patrick.id, ann: U.ann.id, instrDid: U.instrDid.id, liam: U.liam.id };
  let rows = [];
  for (let i = 0; i < 40; i++) {
    rows = await db.notification.findMany({ where: { title: tag }, select: { userId: true, body: true } });
    if (rows.length >= 6) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const who = Object.fromEntries(Object.entries(ids).map(([n, id]) => [n, rows.filter((r) => r.userId === id).map((r) => r.body)]));
  ev.push({ id: 'T8 notification rows', total: rows.length, who });
  ok('T8 parents of booked children get a copy; others none', who.maire.length >= 1 && who.mum.length >= 1 && who.ann.length === 0 && who.liam.length === 0, JSON.stringify(Object.fromEntries(Object.entries(who).map(([n, v]) => [n, v.length]))));
}

// ---- T9: consent withdrawal and step-up ----
if (on('T9')) {
  const b = await req('T9 Mum BASELINE', 'POST', `/guardians/me/minors/${U.niamh.id}/consent`, g(U.mum), { tier: 'BASELINE', policyVersion: 'uk-2026-10' });
  const c = await req('T9 Mum CAMERA', 'POST', `/guardians/me/minors/${U.niamh.id}/consent`, g(U.mum), { tier: 'CAMERA', policyVersion: 'uk-2026-10' });
  const x = await req('T9 Patrick grants consent for Niamh', 'POST', `/guardians/me/minors/${U.niamh.id}/consent`, g(U.patrick), { tier: 'BASELINE', policyVersion: 'x' });
  ok('T9 non-parent cannot consent', x.status === 400 || x.status === 403, `${x.status}`);
  const wc = await req('T9 withdraw CAMERA no step-up', 'PATCH', `/guardians/me/consent/${c.body?.id}/withdraw`, g(U.mum));
  ok('T9 CAMERA withdraw without step-up', wc.status === 200, `${wc.status}`);
  const wb0 = await req('T9 withdraw BASELINE no step-up', 'PATCH', `/guardians/me/consent/${b.body?.id}/withdraw`, g(U.mum));
  ok('T9 BASELINE needs step-up', wb0.status === 401 || wb0.status === 403, `${wb0.status} ${short(wb0.body)}`);
  const wrong = await req('T9 step-up wrong passcode', 'POST', '/auth/step-up/verify', g(U.mum), { passcode: '000000' });
  const su = await req('T9 step-up', 'POST', '/auth/step-up/verify', g(U.mum), { passcode: C.pass });
  const stok = su.body?.stepUpToken || su.body?.token;
  // Step-up token of Patrick replayed by Mum?
  const suP = await req('T9 Patrick step-up', 'POST', '/auth/step-up/verify', g(U.patrick), { passcode: C.pass });
  const cross = await req('T9 Mum withdraw with Patrick step-up', 'PATCH', `/guardians/me/consent/${b.body?.id}/withdraw`, g(U.mum), undefined, { 'x-step-up-token': suP.body?.stepUpToken || suP.body?.token || '' });
  ok('T9 another user\'s step-up token refused', cross.status === 401 || cross.status === 403, `${cross.status}`);
  const before = await db.roleGrant.count({ where: { userId: U.niamh.id, revokedAt: null } });
  const wb = await req('T9 withdraw BASELINE with step-up', 'PATCH', `/guardians/me/consent/${b.body?.id}/withdraw`, g(U.mum), undefined, { 'x-step-up-token': stok || '' });
  const afterGrants = await db.roleGrant.count({ where: { userId: U.niamh.id, revokedAt: null } });
  const med = await db.studentMedicalInfo.count({ where: { studentId: U.niamh.id } });
  ev.push({ id: 'T9 cascade', wrong: wrong.status, stepUp: su.status, withdraw: wb.status, grantsBefore: before, grantsAfter: afterGrants, medicalRows: med });
  ok('T9 BASELINE withdraw cascades (grants revoked, medical erased)', wb.status === 200 && afterGrants === 0 && med === 0, `${wb.status} grants ${before}→${afterGrants} medical=${med}`);
  // Is the other Guardian told, and is the Guardian link still live?
  const link = await db.guardianLink.findMany({ where: { studentId: U.niamh.id }, select: { guardianId: true, revokedAt: true } });
  ev.push({ id: 'T9 links after withdraw', db: link });
  // After withdrawal, can Mum still book / buy / re-enrol Niamh?
  const rj = await req('T9 Mum re-enrols Niamh after withdrawing', 'POST', `/schools/${A}/join`, g(U.mum), { studentId: U.niamh.id, branchId: C.branches.lev });
  ok('T9 after BASELINE withdrawal, re-enrolment without new consent is refused', rj.status >= 400, `${rj.status} ${short(rj.body)}`);
}

fs.writeFileSync(new URL('./tests-evidence.json', import.meta.url), JSON.stringify({ res, ev }, null, 1));
const f = res.filter((r) => !r.pass).length;
console.log(`\n${res.length - f}/${res.length} passed`);
await db.$disconnect();
process.exit(0);
