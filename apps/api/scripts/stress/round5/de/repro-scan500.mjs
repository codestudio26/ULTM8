// Staff book a member of Branch 2 (Spandau) into a Branch 1 (Kreuzberg) class, then check them in.
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const A = cast.A;
const st = cast.studentsA.filter((s) => s.branch === A.branches[1])[Number(process.env.K || 5)];
const b = await call('b', 'POST', `/classes/${A.nowClass}/book`, A.owner.tok, { studentId: st.id });
console.log('book (owner)', b.status, JSON.stringify(b.body).slice(0, 160));
const c = await call('c', 'POST', `/classes/${A.nowClass}/attendance-scan`, A.owner.tok, { studentId: st.id });
console.log('attendance-scan (owner)', c.status, JSON.stringify(c.body).slice(0, 200));
const self = await call('s', 'GET', `/bookings/me`, st.tok);
console.log('member GET /bookings/me', self.status, JSON.stringify(self.body).slice(0, 300));
await db.$disconnect();
