// Round 7 S: clean re-runs of S-3/S-4 on School C (untouched by lifecycle.mjs),
// and the Franchise-move concurrency check at a load the local pool can take.
import { call, must, signIn, rec, saveResults, loadWorld, db } from './lib.mjs';
const w = loadWorld(); const C = w.schools.C, P = C.people, A = w.schools.A, F1 = w.franchises.F1, F2 = w.franchises.F2, B = w.schools.B;
for (const k of ['owner', 'coach', 'staff1', 'adult1', 'parent']) await signIn(P[k]);
for (const p of [F1.owner, F2.owner, B.people.owner, w.extra.stranger]) await signIn(p);
const sig = (r) => `${r.status} ${r.body?.error?.code ?? ''} ${(r.body?.error?.message ?? '').toString().slice(0, 100)}`;
await must('switch on', 'PUT', `/schools/${C.id}/staff/${P.coach.id}/coach-access`, P.owner.tok, { manageStudents: true });
await signIn(P.coach);
rec('recheck', 'C coach with switch on edits b1 student', (await call('PATCH', `/schools/${C.id}/students/${P.adult1.id}/profile`, P.coach.tok, { language: 'fr' })).status === 200);
await must('pause', 'POST', `/schools/${C.id}/staff/${P.coach.id}/pause`, P.owner.tok, {});
await signIn(P.coach);
let r = await call('PATCH', `/schools/${C.id}/students/${P.adult1.id}/profile`, P.coach.tok, { language: 'de' });
rec('recheck', 'S-3: paused coach editing a profile → should be 403 ACCESS_PAUSED', r.status === 403 && r.body?.error?.code === 'ACCESS_PAUSED', sig(r));
r = await call('GET', `/schools/${C.id}/students/${P.adult1.id}/profile`, P.coach.tok);
rec('recheck', 'S-3: paused coach opening the profile form', r.status === 403, sig(r));
await must('unpause', 'POST', `/schools/${C.id}/staff/${P.coach.id}/unpause`, P.owner.tok, {});
await must('pause staff', 'POST', `/schools/${C.id}/staff/${P.staff1.id}/pause`, P.owner.tok, {});
await signIn(P.staff1);
r = await call('PATCH', `/schools/${C.id}/students/${P.adult1.id}/profile`, P.staff1.tok, { language: 'de' });
rec('recheck', 'S-3: paused Branch Staff editing a profile → should be 403 ACCESS_PAUSED', r.status === 403 && r.body?.error?.code === 'ACCESS_PAUSED', sig(r));
r = await call('GET', `/schools/${C.id}/student-tags`, P.staff1.tok);
rec('recheck', 'S-4: paused Branch Staff on student tags → should be 403 ACCESS_PAUSED', r.status === 403 && r.body?.error?.code === 'ACCESS_PAUSED', sig(r));
await must('unpause staff', 'POST', `/schools/${C.id}/staff/${P.staff1.id}/unpause`, P.owner.tok, {});
r = await call('GET', `/schools/${C.id}/student-tags`, P.adult1.tok);
rec('recheck', 'S-4: member on student tags → should be 403 NO_PERMISSION', r.status === 403 && r.body?.error?.code === 'NO_PERMISSION', sig(r));
r = await call('PATCH', `/schools/${C.id}/students/${P.adult1.id}/profile`, P.parent.tok, { language: 'de' });
rec('recheck', 'S-4: member/parent editing a profile → should be 403 NO_PERMISSION', r.status === 403 && r.body?.error?.code === 'NO_PERMISSION', sig(r));
r = await call('GET', `/schools/${C.id}/student-tags`, w.extra.stranger.tok);
rec('recheck', 'S-4: stranger on student tags (should be 404; same for a missing School?)', r.status === 404, sig(r) + ' | missing: ' + sig(await call('GET', `/schools/00000000-0000-4000-8000-0000000000cc/student-tags`, w.extra.stranger.tok)));

// Concurrency at 8 in flight: B moves between F2 and F1 while both owners read.
const ids = (x) => (x.body?.schools ?? []).map((s) => s.schoolId);
let stop = false; const bad = []; let n = 0;
const reader = async () => { while (!stop) { for (const [f, tok, ok] of [[F1, F1.owner.tok, [A.id, B.id]], [F2, F2.owner.tok, [B.id, C.id]]]) { const x = await call('GET', `/franchises/${f.id}/overview`, tok); n++; if (x.status !== 200 || ids(x).some((i) => !ok.includes(i))) bad.push(sig(x) + ' ' + ids(x)); } } };
const readers = Array.from({ length: 6 }, reader);
const moveErr = [];
for (let i = 0; i < 6; i++) {
  const to = i % 2 === 0 ? F1 : F2;
  const l = await call('POST', `/schools/${B.id}/leave-franchise`, B.people.owner.tok, {});
  const q = await call('POST', `/schools/${B.id}/join-franchise`, B.people.owner.tok, { franchiseId: to.id });
  const a = q.body?.id ? await call('POST', `/franchises/${to.id}/join-requests/${q.body.id}/accept`, to.owner.tok, {}) : { status: 0 };
  moveErr.push(`${l.status}/${q.status}/${a.status}`);
}
stop = true; await Promise.all(readers);
rec('recheck', `concurrency (6 readers, 6 moves): every overview 200 and only its own Schools`, bad.length === 0, `${n} reads; bad=${bad.slice(0, 3).join(';')}; moves ${moveErr.join(' ')}`);
saveResults('recheck'); await db.$disconnect();
