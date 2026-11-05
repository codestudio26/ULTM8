// Round 5 BR extras: Kid Mode for a parent who trains, desk sale to a minor (who is told),
// undoing a mistaken Pix desk sale. CAST=../empty-cast.json node extra.mjs
import fs from 'fs';
import { db, call, checks } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-br.json', import.meta.url)));
const { ok, save } = checks('extra');
const log = (...a) => console.log('   ', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const S = C.S, T = C.tok, B = C.branches;
const out = {};
const kinds = Object.fromEntries(C.students.map((s) => [s.id, s]));
// Kid Mode: plain parent (g2) vs parent who trains (g1), same child
const kid = C.big.kids.find((k) => kinds[k].branch === B.SP && ['sub', 'pack10', 'pack5'].includes(kinds[k].kind)) ?? C.big.kids[0];
const cls = await db.class.findMany({ where: { schoolId: S, branchId: kinds[kid].branch, title: { startsWith: 'Kids' }, cancelledAt: null, startDate: { gt: new Date(Date.now() + 2 * 86400e3) } }, orderBy: { startDate: 'asc' }, take: 6 });
for (const [who, tok, c] of [['plain parent', C.big.g2tok, cls[4]], ['parent who trains', C.big.g1tok, cls[5]]]) {
  const del = await call('k', 'POST', `/guardians/me/minors/${kid}/booking-delegation`, tok, {});
  const km = await call('k', 'POST', `/guardians/me/minors/${kid}/kid-mode-token`, tok, {});
  const kt = km.body?.token ?? km.body?.accessToken;
  const b = kt ? await call('k', 'POST', `/classes/${c.id}/book`, kt, { studentId: kid }) : null;
  log(who, 'delegation', del.status, 'kid-mode token', km.status, 'kid books', b?.status, b?.body?.error?.message ?? b?.body?.status);
  out[who] = { delegation: del.status, token: km.status, book: b && { status: b.status, body: b.body?.error ?? b.body?.status } };
}
ok('K1 Kid Mode booking works for a plain parent and for a parent who trains', out['plain parent'].book?.status === 201 && out['parent who trains'].book?.status === 201, JSON.stringify(out));

// Desk sale to a child with two parents, from both owner paths: who is told?
const minors = C.families.filter((f) => f.kids.length >= 2).flatMap((f) => f.kids).filter((k) => kinds[k].kind === 'none' && kinds[k].branch === B.SP);
const [m1, m2] = minors;
const t0 = new Date();
const a = await call('d', 'POST', `/schools/${S}/students/${m1}/memberships/sell`, T.owner, { membershipPlanId: C.plans.pack5, paymentMethod: 'PIX' });
const b = await call('d', 'POST', `/schools/${S}/desk-payments`, T.owner, { studentId: m2, membershipPlanId: C.plans.pack5, paymentMethod: 'PIX' });
await new Promise((r) => setTimeout(r, 5000));
const told = async (k) => {
  const gs = (await db.guardianLink.findMany({ where: { studentId: k } })).map((l) => l.guardianId);
  const n = await db.notification.findMany({ where: { userId: { in: [k, ...gs] }, createdAt: { gte: t0 } }, select: { userId: true, title: true, body: true } });
  return { guardians: gs.length, notices: n };
};
out.deskMinor = { sellPath: { status: a.status, ...(await told(m1)) }, deskPaymentsPath: { status: b.status, ...(await told(m2)) } };
log('desk sale to a minor', JSON.stringify(out.deskMinor).slice(0, 600));
ok('D1 parent told of a Pix desk sale for their child on both owner paths', out.deskMinor.sellPath.notices.length > 0 && out.deskMinor.deskPaymentsPath.notices.length > 0, `sell: ${out.deskMinor.sellPath.notices.length} notices; desk-payments: ${out.deskMinor.deskPaymentsPath.notices.length}`);

// Undo a mistaken Pix desk sale (wrong child / wrong plan)
const txId = b.body?.transactionId ?? a.body?.transactionId;
const cx = await call('u', 'PATCH', `/transactions/${txId}/cancel`, T.owner, { reason: 'Lançado no aluno errado' });
const rf = await call('u', 'POST', `/schools/${S}/charge-payments/${txId}/refund`, T.owner, { amount: 19990, destination: 'MONEY_BACK', notes: 'Pix devolvido' });
out.undo = { cancel: { status: cx.status, body: cx.body }, refund: { status: rf.status, body: rf.body } };
log('undo a Pix desk sale: cancel', cx.status, cx.body?.error?.message, '| refund', rf.status, rf.body?.error?.message);

// Bookings summary week vs the School's week start
const sch = await call('w', 'GET', `/schools/${S}`, T.owner);
const sum = await call('w', 'GET', `/schools/${S}/bookings/summary`, T.owner);
out.week = { weekStartsOn: sch.body.weekStartsOn, from: sum.body.from, to: sum.body.to, todaySaoPaulo: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) };
log('week', out.week);
fs.writeFileSync(new URL('./extra-out.json', import.meta.url), JSON.stringify(out, null, 1));
save();
await db.$disconnect();
