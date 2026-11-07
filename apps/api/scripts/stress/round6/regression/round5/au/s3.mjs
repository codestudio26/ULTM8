// S3 rerun: Perth Branch Staff with every switch off (Decision 387), then restored.
import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const sid = A.schoolId;
const owner = tokenRca({ id: A.owner, email: 'o' }, [grant('SCHOOL_OWNER_MANAGER', sid)]);
const keys = ['classes', 'bookings', 'students', 'cancelClasses', 'staffList', 'disciplines', 'checkInRules', 'exportStudents', 'freezeMemberships', 'attendanceStats', 'seeMedicalInfo', 'memberFiles', 'importData'];
const off = Object.fromEntries(keys.map((k) => [k, false]));
const set = await call('s3', 'PUT', `/schools/${sid}/staff/${A.staffPer}/access`, owner, off);
console.log('set', set.status, JSON.stringify(set.body).slice(0, 200));
const st = (await db.user.findUnique({ where: { id: A.staffPer }, select: { rolesChangedAt: true } })).rolesChangedAt?.getTime() ?? Date.now();
const t = tokenRca({ id: A.staffPer, email: 'p' }, [grant('BRANCH_STAFF', sid, A.branches.per)], st);
const perStud = A.students.filter((s) => s.b === 'per' && s.tag === 'adult' && A.memberships[s.id]);
const r = await Promise.all([
  call('s3', 'GET', `/classes/${A.classes.nowPer}/bookings`, t),
  call('s3', 'POST', `/classes/${A.classes.nowPer}/attendance-scan`, t, { studentId: perStud[3].id }),
  call('s3', 'GET', `/classes/${A.classes.nowPer}/qr-token`, t),
  call('s3', 'GET', `/schools/${sid}/students`, t),
  call('s3', 'POST', `/classes/${A.classes.nowPer}/book`, t, { studentId: perStud[30].id }),
  call('s3', 'GET', `/classes/${A.classes.nowPer}/waitlist`, t),
  call('s3', 'GET', `/schools/${sid}/staff`, t),
]);
console.log(['rollcall', 'scan', 'qr', 'roster', 'book', 'waitlist', 'staff'].map((n, i) => `${n}=${r[i].status} ${r[i].body?.error?.code ?? ''}`).join(' | '));
const on = await call('s3', 'PUT', `/schools/${sid}/staff/${A.staffPer}/access`, owner, { ...off, bookings: true, students: true, cancelClasses: true });
console.log('restore', on.status);
await db.$disconnect();
