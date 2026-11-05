import { C, tk, call, saveCast, S, short } from './lib.mjs';
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const disc = await call('seed:style', 'POST', `/schools/${S}/disciplines`, tOwner, { name: 'مواي تاي Muay Thai' });
const disc2 = await call('seed:style2', 'POST', `/schools/${S}/disciplines`, tOwner, { name: 'لياقة نسائية' });
console.log('disciplines', disc.status, disc2.status, short(disc.body));
C.styles = [{ disciplineId: disc.body.id, classType: (disc.body.classTypesOffered || [])[0] ?? null }];
C.styles2 = [{ disciplineId: disc2.body.id, classType: (disc2.body.classTypesOffered || [])[0] ?? null }];
const [i0, i1] = C.instrs; const D = C.branches.dubai, A = C.branches.abu;
const defs = [
  ['MONDAY', '18:00', '19:30', D, i0, 'مواي تاي للمبتدئين', 1], ['MONDAY', '10:00', '11:00', D, i0, 'لياقة للسيدات فقط (Ladies only)', 2],
  ['TUESDAY', '19:00', '20:30', D, i0, 'Muay Thai Advanced متقدم', 1], ['WEDNESDAY', '17:00', '18:00', D, i0, 'مواي تاي للأطفال 6-12', 1],
  ['THURSDAY', '20:00', '21:30', D, i0, 'Sparring نزال', 1], ['FRIDAY', '09:00', '10:30', D, i0, 'جمعة صباحية', 1],
  ['FRIDAY', '16:00', '17:30', D, i0, 'بعد صلاة الجمعة', 1], ['SATURDAY', '10:00', '11:30', D, i0, 'Weekend Open Mat', 1],
  ['SUNDAY', '23:00', '00:30', D, i0, 'Late night قبل منتصف الليل', 1],
  ['MONDAY', '19:00', '20:00', A, i1, 'لياقة السيدات - أبوظبي', 2], ['WEDNESDAY', '19:00', '20:30', A, i1, 'مواي تاي أبوظبي', 1], ['SATURDAY', '11:00', '12:00', A, i1, 'Kids أطفال', 1],
];
C.slots = [];
for (const [d, s, e, b, ins, title, st] of defs) {
  const r = await call('seed:slot', 'POST', `/schools/${S}/timetable`, tOwner, { branchId: b, instructorId: ins.id, weekday: d, startTime: s, endTime: e, title, styles: st === 1 ? C.styles : C.styles2, capacity: 20, membershipInclusion: true });
  C.slots.push({ id: r.body?.id, status: r.status, title, branch: b, weekday: d, start: s });
  if (r.status >= 300) console.log('slot fail', title, r.status, short(r.body));
}
console.log('slots', C.slots.map((s) => s.status).join(','));
saveCast();
