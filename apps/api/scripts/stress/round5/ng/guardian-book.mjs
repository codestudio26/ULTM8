// NG: a parent books their own child. Guardians get no RoleGrant in the real app
// (GuardianLink only), so tokens here carry only the parent's own roles.
import fs from 'fs';
import { db, call, grant, tokenRca, codes } from '../../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(new URL('./ng-cast.json', import.meta.url)));
const S = c.schoolId;
const clsAt = (branch, k) => c.classes.future.filter((_, i) => (i % 2 === 0 ? c.branches.island : c.branches.ikeja) === branch)[k];
const out = [];
async function tryBook(label, guardianTok, kid, cls) {
  const r = await call(label, 'POST', `/classes/${cls}/book`, guardianTok, { studentId: kid.id });
  const row = { label, status: r.status, body: JSON.stringify(r.body).slice(0, 220) };
  out.push(row); console.log(row);
  if (r.status < 300) await call(label + ':cancel', 'PATCH', `/bookings/${r.body.id}/cancel`, guardianTok, { studentId: kid.id });
  return r;
}
// (a) pure parent (no roles at the School): Chinedu Eze books Zainab
const dad = c.guardians.dad;
await tryBook('a pure parent books child', tokenRca(dad, []), c.special.divorcedKid, clsAt(c.special.divorcedKid.branch, 7));
// (b) parent who trains at the same Branch: Ngozi Okafor (Student at Lagos Island) books Emeka (Lagos Island)
const ok = c.guardians.okafor;
const tOk = tokenRca(ok, [grant('STUDENT', S, c.branches.island)]);
await tryBook('b parent who trains at the same Branch books child', tOk, c.special.kid9b, clsAt(c.special.kid9b.branch, 7));
// (b2) same parent books Chiamaka, who trains at Ikeja
await tryBook('b2 same parent books child at the other Branch', tOk, c.special.kid7a, clsAt(c.special.kid7a.branch, 7));
// (c) a coach who is a parent: Tèmítọ́pẹ́ (Instructor, Lagos Island) books Babátúndé (teen)
const coach = c.instructors[2];
await tryBook('c coach-parent books own child', tokenRca(coach, [grant('INSTRUCTOR', S, c.branches.island)]), c.special.teen15, clsAt(c.special.teen15.branch, 7));
// (d) the owner as a parent: link the owner to the toddler and book
await db.guardianLink.create({ data: { guardianId: c.owner.id, studentId: c.special.toddler3.id } }).catch(() => {});
await tryBook('d owner-parent books own child', c.owner.tok, c.special.toddler3, clsAt(c.special.toddler3.branch, 7));
// (e) parent who trains cancels child's booking made by the other parent
fs.writeFileSync(new URL('./guardian-book.json', import.meta.url), JSON.stringify(out, null, 1));
await db.$disconnect();
