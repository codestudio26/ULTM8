import { C, tk, call, S, short, pool, codes, db } from './lib.mjs';
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const rs = await pool(C.students, 8, (st) => call('home', 'PUT', `/schools/${S}/students/${st.id}/home-branch`, tOwner, { branchId: st.branch }));
console.log(codes(rs), short(rs.find((r) => r.status >= 300)?.body));
await db.$disconnect();
