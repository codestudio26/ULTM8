import { call, db } from '/home/user/ULTM8/.claude/worktrees/round7-R/apps/api/scripts/rehearsal/lib.mjs';
for (const email of ['ana.souza.mwb6kwno@rehearsal.test', 'emma.clarke.mwb6kwno@rehearsal.test']) {
  const u = await db.user.findUnique({ where: { email }, select: { id: true } });
  const g = await db.roleGrant.findFirst({ where: { userId: u.id, role: 'STUDENT', revokedAt: null }, select: { schoolId: true } });
  const cls = await db.class.findMany({ where: { schoolId: g.schoolId, startDate: { gt: new Date() }, archivedAt: null, cancelledAt: null }, orderBy: { startDate: 'asc' }, take: 15, select: { id: true } }); let r; for (const cl of cls.slice(0, 15)) { r = await call('POST', `/classes/${cl.id}/book`, (await call('POST', '/auth/login', null, { email, passcode: '482913' })).body.accessToken, {}); if (r.body?.error?.code !== 'CLASS_FULL') break; }


  console.log(email, r.status, r.body?.error?.code, r.body?.error?.message);
}
await db.$disconnect();
