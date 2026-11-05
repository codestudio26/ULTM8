// Leaving, closing a Branch, closing two Schools, and what the purge jobs
// really delete. PHASE=1 does the actions and backdates purgeAt on our own
// rows; PHASE=2 runs the two purge queues and snapshots what is left.
import fs from 'fs';
import { db, call, QueueEvents, Queue } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const life = JSON.parse(fs.readFileSync(new URL('./cast-life.json', import.meta.url)));
const { A, C, D } = cast; const S = cast.shared.id;
const PHASE = process.env.PHASE || '1';
const stateFile = new URL('./closure-state.json', import.meta.url);
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};
const log = (...a) => console.log(...a);
const short = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 220)}`;

const TABLES = ['AuditLogEntry', 'BalanceEntry', 'Booking', 'BookingAttendee', 'Branch', 'Charge', 'ChildInvite', 'Class', 'Closure', 'CoachInvite', 'Discipline', 'FrontDeskSession', 'Instructor', 'MemberFile', 'Membership', 'MembershipPlan', 'Notification', 'NotificationBroadcast', 'PaymentAccount', 'RoleGrant', 'SchoolTag', 'SignUp', 'SignedDocumentExport', 'StaffActivity', 'StaffKioskCode', 'StudentCheckInCode', 'StudentExportLog', 'StudentHomeBranch', 'StudentJoinDate', 'StudentMedicalInfo', 'StudentNote', 'StudentTag', 'TimetableSlot', 'Transaction', 'WaitlistEntry', 'Waiver', 'WaiverSignature', 'WaiverSignaturePurgeLog'];
async function snapshot(schoolId) {
  const out = {};
  for (const t of TABLES) {
    try { out[t] = Number((await db.$queryRawUnsafe(`select count(*)::int n from "${t}" where "schoolId" = $1`, schoolId))[0].n); } catch (e) { out[t] = 'n/a'; }
  }
  const s = await db.school.findUnique({ where: { id: schoolId }, select: { name: true, archivedAt: true, purgeAt: true, purgedAt: true } });
  out.School = s ? `${s.name} archived=${s.archivedAt?.toISOString() ?? null} purgeAt=${s.purgeAt?.toISOString() ?? null} purgedAt=${s.purgedAt?.toISOString() ?? null}` : 'DELETED';
  return out;
}
async function runJob(name) {
  const q = new Queue(name, { connection: { url: process.env.REDIS_URL } });
  const ev = new QueueEvents(name, { connection: { url: process.env.REDIS_URL } });
  await ev.waitUntilReady();
  const t0 = Date.now(); const job = await q.add('run', {});
  let res;
  try { await job.waitUntilFinished(ev, 600e3); res = `ok ${(Date.now() - t0) / 1000}s`; } catch (e) { res = 'FAILED ' + String(e.message).slice(0, 200); }
  await ev.close(); await q.close();
  return res;
}

if (PHASE === '1') {
  // --- L: a member leaves (Tobias, wheelchair user with medical info) ---
  const tob = cast.special[9];
  await call('note', 'POST', `/schools/${A.id}/students/${tob.id}/notes`, A.owner.tok, { body: 'A-NOTE Tobias: Rollstuhl, braucht Rampe Halle 2', showToMember: false });
  const grants = await call('grants', 'GET', `/users/${tob.id}/role-grants`, A.owner.tok);
  const g = (grants.body?.items ?? grants.body ?? []).find?.((x) => x.role === 'STUDENT' && x.schoolId === A.id);
  log('L0 grants', grants.status, g?.id);
  const medBefore = await db.studentMedicalInfo.count({ where: { studentId: tob.id, schoolId: A.id } });
  const rv = await call('revoke', 'DELETE', `/users/${tob.id}/role-grants/${g?.id}`, A.owner.tok);
  const medAfter = await db.studentMedicalInfo.count({ where: { studentId: tob.id, schoolId: A.id } });
  const notesAfter = await db.studentNote.count({ where: { studentId: tob.id, schoolId: A.id } });
  log('L1 revoke', short(rv), `medical before=${medBefore} after=${medAfter}; notes kept=${notesAfter}`);
  state.leaver = tob.id;

  // --- BR: close a third Branch of A ---
  const br = await call('branch', 'POST', `/schools/${A.id}/branches`, A.owner.tok, { name: 'Dojo Wedding (Testhalle)' });
  log('BR0 create', short(br));
  const wid = br.body?.id; state.branch = wid;
  const movers = cast.studentsA.slice(40, 45);
  for (const m of movers) await call('hb', 'PUT', `/schools/${A.id}/students/${m.id}/home-branch`, A.owner.tok, { branchId: wid });
  const slot = await call('slot', 'POST', `/schools/${A.id}/timetable`, A.owner.tok, { branchId: wid, instructorId: A.instr[0], weekday: 'THURSDAY', startTime: '18:00', endTime: '19:00', title: 'Judo Wedding', styles: [{ disciplineId: A.disc.Judo, classType: null }], capacity: 20 });
  log('BR1 slot at the new Branch', slot.status, slot.status >= 300 ? JSON.stringify(slot.body).slice(0, 200) : '');
  const pv = await call('pv', 'GET', `/branches/${wid}/close-preview`, A.owner.tok);
  log('BR2 close-preview', short(pv));
  const cl = await call('close', 'POST', `/branches/${wid}/close`, A.owner.tok, { classesTo: A.branches[0], studentsTo: A.branches[0], instructorsTo: A.branches[0], staffTo: A.branches[0] });
  log('BR3 close', short(cl));
  const brow = await db.branch.findUnique({ where: { id: wid }, select: { archivedAt: true, purgeAt: true } });
  log('BR4 branch row', JSON.stringify(brow), 'home-branch rows still pointing to it:', await db.studentHomeBranch.count({ where: { branchId: wid } }).catch(() => 'n/a'));
  if (brow?.purgeAt) await db.branch.update({ where: { id: wid }, data: { purgeAt: new Date(Date.now() - 60e3) } });

  // --- C: owner closes the School ---
  state.before = { C: await snapshot(C.id), D: await snapshot(D.id) };
  for (const [k, s] of [['C', C], ['D', D]]) {
    const su = await call('stepup', 'POST', `/auth/step-up/verify`, s.owner.tok, { passcode: cast.pass });
    const stepTok = su.body?.stepUpToken ?? su.body?.token;
    log(`${k}0 step-up`, su.status, Object.keys(su.body || {}).join(','));
    const wrong = await call('close', 'POST', `/schools/${s.id}/close`, s.owner.tok, { confirmName: s.name.toUpperCase() }, { 'x-step-up-token': stepTok });
    log(`${k}1 close with the name in capitals`, short(wrong));
    const ok = await call('close', 'POST', `/schools/${s.id}/close`, s.owner.tok, { confirmName: s.name }, { 'x-step-up-token': stepTok });
    log(`${k}2 close`, short(ok));
  }
  // After close: what can still happen at C?
  const after = {
    ownerCreatesClass: await call('x', 'POST', `/schools/${C.id}/classes`, C.owner.tok, { branchId: C.branches[0], instructorId: C.instr[0], title: 'nach Schließung', styles: [{ disciplineId: C.disc.Judo, classType: null }], startDate: new Date(Date.now() + 86400e3).toISOString(), endDate: new Date(Date.now() + 90000e3).toISOString(), capacity: 5 }),
    ownerNote: await call('x', 'POST', `/schools/${C.id}/students/${S}/notes`, C.owner.tok, { body: 'C-NOTE nach Schließung' }),
    ownerReadsStudents: await call('x', 'GET', `/schools/${C.id}/students`, C.owner.tok),
    ownerExport: await call('x', 'GET', `/schools/${C.id}/students/export`, C.owner.tok),
    ownerBroadcast: await call('x', 'POST', `/schools/${C.id}/notifications/broadcast`, C.owner.tok, { title: 'C-BROADCAST nach Schließung', body: 'x', audience: 'ALL' }),
    memberBooks: await call('x', 'POST', `/classes/${C.futureClass}/book`, cast.studentsC[12].tok, { studentId: cast.studentsC[12].id }),
    memberSigns: await call('x', 'POST', `/waivers/${life.waivers.C}/sign`, cast.studentsC[15].tok, { signerFullName: 'Spät', signatureText: 'S' }),
    sharedBookingsMe: await call('x', 'GET', `/bookings/me`, cast.shared.tok),
    sharedMembershipsMe: await call('x', 'GET', `/memberships/me`, cast.shared.tok),
    guardianMinorSchools: await call('x', 'GET', `/guardians/me/minors/${cast.kidC}/schools`, cast.gC.tok),
    guardianMedicalList: await call('x', 'GET', `/students/${cast.kidC}/medical-info`, cast.gC.tok),
    reopenByOwner: await call('x', 'PATCH', `/schools/${C.id}`, C.owner.tok, { name: 'wieder offen' }),
  };
  for (const [k, r] of Object.entries(after)) {
    const txt = JSON.stringify(r.body);
    log(`CA ${k}`, r.status, /C-WAIVER|Schließungstest|Köpenick/.test(txt) ? '(mentions C)' : '', txt.slice(0, 200));
  }
  const sc = await db.school.findUnique({ where: { id: C.id }, select: { archivedAt: true, purgeAt: true } });
  log('C row', JSON.stringify(sc));
  // Pretend the 90 days are over (our own Schools only).
  await db.school.updateMany({ where: { id: { in: [C.id, D.id] } }, data: { purgeAt: new Date(Date.now() - 60e3) } });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
}

if (PHASE === '2') {
  log('job entity-offboarding-purge', await runJob('entity-offboarding-purge'));
  log('job tenant-lifecycle-purge', await runJob('tenant-lifecycle-purge'));
  log('job entity-offboarding-purge (2nd)', await runJob('entity-offboarding-purge'));
  log('job tenant-lifecycle-purge (2nd)', await runJob('tenant-lifecycle-purge'));
  const afterC = await snapshot(C.id), afterD = await snapshot(D.id);
  const rows = Object.keys(afterC).map((t) => ({ table: t, C_before: state.before.C[t], C_after: afterC[t], D_before: state.before.D[t], D_after: afterD[t] }));
  console.table(rows.filter((r) => r.C_before !== 0 || r.C_after !== 0 || r.D_before !== 0 || r.D_after !== 0));
  // People: User rows, Guardian links and consent of C-only people stay?
  const cIds = cast.studentsC.map((s) => s.id);
  log('C-only member User rows left:', await db.user.count({ where: { id: { in: cIds } } }), 'of', cIds.length);
  log('C child User row:', await db.user.count({ where: { id: cast.kidC } }), 'GuardianLink:', await db.guardianLink.count({ where: { studentId: cast.kidC } }), 'ConsentRecord:', await db.consentRecord.count({ where: { studentId: cast.kidC } }));
  log('C notifications left in members\' inboxes (any School):', await db.notification.count({ where: { userId: { in: [...cIds, cast.kidC, cast.gC.id] } } }));
  const sample = await db.notification.findMany({ where: { userId: { in: [...cIds, cast.gC.id] } }, select: { title: true, body: true, schoolId: true }, take: 3 });
  log('sample', JSON.stringify(sample));
  log('Shared member at A untouched: A notes', await db.studentNote.count({ where: { studentId: S, schoolId: A.id } }), 'A medical', await db.studentMedicalInfo.count({ where: { studentId: S, schoolId: A.id } }), 'A bookings', await db.booking.count({ where: { studentId: S, schoolId: A.id } }));
  const br = state.branch && await db.branch.findUnique({ where: { id: state.branch }, select: { archivedAt: true, purgeAt: true, purgedAt: true } });
  log('Closed Branch after purge:', br ? JSON.stringify(br) : 'DELETED');
  log('Leaver (Tobias) at A: notes', await db.studentNote.count({ where: { studentId: state.leaver, schoolId: A.id } }), 'medical', await db.studentMedicalInfo.count({ where: { studentId: state.leaver } }), 'bookings', await db.booking.count({ where: { studentId: state.leaver, schoolId: A.id } }), 'membership', await db.membership.count({ where: { studentId: state.leaver, schoolId: A.id } }));
  fs.writeFileSync(new URL('./closure-result.json', import.meta.url), JSON.stringify({ before: state.before, afterC, afterD }, null, 1));
}
await db.$disconnect();
