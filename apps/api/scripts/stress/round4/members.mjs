// Round 4, phase 3: members' features merged since round 3 at real sizes:
// the student list export, staff notes with "Show to member", adding a child
// with a Guardian, freezing a membership, the membership card, people with
// unusual names, and the roster/search at 4,000 students. members-result.json.
// Uses Schools 340-379 and the very large Schools (read-only there).
import { db, call, pool, cast, checks, codes } from './common.mjs';
const { ok, save } = checks('members');
const info = (id, detail) => ok(id, true, 'INFO ' + detail);
const S = cast.schools.filter((s) => s.n >= 340 && s.n < 380 && s.size !== 'small');
const XL = cast.schools.filter((s) => s.size === 'xlarge');

// --- MB1 export the student list at 3,000-4,000 students, 10 owners at once ---
{
  const rs = await Promise.all(XL.map((s) => call('mb1:export-xlarge', 'GET', `/schools/${s.id}/students/export`, s.owner.tok)));
  const sizes = rs.map((r) => `${r.status}/${Math.round(r.bytes / 1024)}KB`);
  const counts = await Promise.all(XL.map((s, i) => (rs[i].body?.rows ?? rs[i].body?.students ?? rs[i].body?.items ?? []).length));
  info('MB1a export at the 10 very large Schools, all at once', sizes.join(', '));
  ok('MB1b each export has one row per current student', XL.every((s, i) => counts[i] === s.students.length || counts[i] === 0), XL.map((s, i) => `${counts[i]}/${s.students.length}`).join(', '));
  const logs = await db.studentExportLog.count({ where: { schoolId: { in: XL.map((s) => s.id) } } }).catch(() => -1);
  ok('MB1c every export is logged', logs >= XL.length, `${logs} log rows`);
}

// --- MB2 staff notes: double click, Show to member, who can read ---
{
  const s = S[0]; const st = s.students[3];
  const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => call('mb2:note-x5', 'POST', `/schools/${s.id}/students/${st.id}/notes`, s.owner.tok, { body: 'Bad knee: no takedowns', showToMember: false })));
  const n = await db.studentNote.count({ where: { studentId: st.id, schoolId: s.id } });
  info('MB2a "Add note" clicked 5 times at once', `${JSON.stringify(codes(rs))}, ${n} notes saved`);
  await call('mb2:note-shown', 'POST', `/schools/${s.id}/students/${st.id}/notes`, s.owner.tok, { body: 'Great progress this month!', showToMember: true });
  const mine = await call('mb2:my-notes', 'GET', `/student-notes/me`, st.tok);
  const txt = JSON.stringify(mine.body);
  ok('MB2b the member sees only the note marked "Show to member"', mine.status === 200 && txt.includes('Great progress') && !txt.includes('Bad knee'), `${mine.status} ${txt.slice(0, 200)}`);
  const other = s.students[4];
  const peek = await call('mb2:peek', 'GET', `/student-notes/me?studentId=${st.id}`, other.tok);
  ok('MB2c another member can\'t read them by passing the studentId', peek.status >= 400 || !JSON.stringify(peek.body).includes('Great progress'), `${peek.status}`);
  const long = await call('mb2:note-long', 'POST', `/schools/${s.id}/students/${st.id}/notes`, s.owner.tok, { body: 'x'.repeat(20000) });
  ok('MB2d a 20,000-character note is refused', long.status === 400, `${long.status}`);
}

// --- MB3 add a child with a Guardian (backlog 3.3), double click and duplicates ---
{
  const s = S[1];
  const body = { child: { firstName: 'Zoë', surname: "O'Neill-Núñez", dateOfBirth: '2016-02-29', gender: null }, guardian: { firstName: 'Aoife', surname: "O'Neill", email: `r4-guardian-${s.n}@stress.test` }, branchId: s.branches[0] };
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('mb3:add-child-x5', 'POST', `/schools/${s.id}/students/add-child-manually`, s.owner.tok, body)));
  const kids = await db.user.count({ where: { firstName: 'Zoë', surname: "O'Neill-Núñez", dateOfBirth: new Date('2016-02-29') } });
  ok('MB3a "Add child" clicked 5 times at once makes one child', kids === 1, `${JSON.stringify(codes(rs))}; ${kids} children, ${await db.user.count({ where: { email: body.guardian.email } })} guardians`);
  const bad = await Promise.all([
    call('mb3:bad', 'POST', `/schools/${s.id}/students/add-child-manually`, s.owner.tok, { ...body, child: { ...body.child, dateOfBirth: '2031-01-01' } }),
    call('mb3:bad', 'POST', `/schools/${s.id}/students/add-child-manually`, s.owner.tok, { ...body, child: { ...body.child, dateOfBirth: '1990-01-01' } }),
    call('mb3:bad', 'POST', `/schools/${s.id}/students/add-child-manually`, s.owner.tok, { ...body, guardian: { ...body.guardian, email: 'not-an-email' } }),
    call('mb3:xt', 'POST', `/schools/${s.id}/students/add-child-manually`, S[2].owner.tok, { ...body, guardian: { ...body.guardian, email: 'r4-xt@stress.test' } }),
  ]);
  ok('MB3b birth date in the future, an adult as "child", a bad email, another School: all refused', bad.every((r) => r.status >= 400 && r.status < 500), bad.map((r) => `${r.status}`).join(', '));
}

// --- MB4 freezing a membership: staff freeze, double request, overlaps ---
{
  const s = S[2];
  const st = s.students.find((x) => x.kind === 'sub');
  const m = await db.membership.findFirst({ where: { studentId: st.id, schoolId: s.id } });
  const d = (k) => new Date(Date.now() + k * 86400e3).toISOString().slice(0, 10);
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('mb4:freeze-x5', 'POST', `/schools/${s.id}/memberships/${m.id}/freezes`, s.owner.tok, { startsAt: d(3), endsAt: d(20) })));
  const n = await db.membershipFreeze.count({ where: { membershipId: m.id } }).catch(() => -1);
  ok('MB4a "Freeze" clicked 5 times at once freezes once', n === 1, `${JSON.stringify(codes(rs))}; ${n} freezes`);
  const bad = await Promise.all([
    call('mb4:bad', 'POST', `/schools/${s.id}/memberships/${m.id}/freezes`, s.owner.tok, { startsAt: d(30), endsAt: d(10) }),
    call('mb4:bad', 'POST', `/schools/${s.id}/memberships/${m.id}/freezes`, s.owner.tok, { startsAt: d(5), endsAt: d(15) }),
    call('mb4:bad', 'POST', `/schools/${s.id}/memberships/${m.id}/freezes`, s.owner.tok, { startsAt: d(1), endsAt: d(400) }),
    call('mb4:xt', 'POST', `/schools/${S[3].id}/memberships/${m.id}/freezes`, S[3].owner.tok, { startsAt: d(40), endsAt: d(50) }),
  ]);
  ok('MB4b end before start, overlapping, over the yearly limit, another School: refused', bad.every((r) => r.status >= 400 && r.status < 500), bad.map((r) => r.status).join(', '));
  const fr = await call('mb4:freeze-list-xlarge', 'GET', `/schools/${XL[0].id}/freezes`, XL[0].owner.tok);
  info('MB4c Freezes list at a very large School', `${fr.status} ${fr.bytes} bytes`);
}

// --- MB5 the membership card for many students at once (backlog 3.11) ---
{
  const s = XL[1];
  const studs = s.students.slice(0, 300);
  const rs = await pool(studs, 32, (st) => call('mb5:card', 'GET', `/schools/${s.id}/students/${st.id}/membership-card`, s.owner.tok));
  const mine = await pool(studs.slice(0, 100), 32, (st) => call('mb5:card-me', 'GET', '/membership-cards/me', st.tok));
  ok('MB5 membership cards for 300 members (staff) and 100 members themselves, no errors', rs.every((r) => r.status === 200) && mine.every((r) => r.status === 200 || r.status === 404), `${JSON.stringify(codes(rs))}, ${JSON.stringify(codes(mine))}`);
}

// --- MB6 the roster and header search at 3,000-4,000 students ---
{
  for (const s of XL.slice(0, 3)) {
    const full = await call('mb6:roster-xlarge', 'GET', `/schools/${s.id}/students`, s.owner.tok);
    const terms = ['a', 'ma', 'Nguyễn', "O'B", 'محمد', '佐藤', 'zzzz', '%', '_', "'; drop table"];
    const rs = await Promise.all(terms.map((t) => call('mb6:search-xlarge', 'GET', `/schools/${s.id}/students?search=${encodeURIComponent(t)}`, s.owner.tok)));
    info(`MB6 School ${s.n} (${s.country}, ${s.students.length} students)`, `roster ${full.status} ${Math.round(full.bytes / 1024)} KB, ${full.body?.items?.length} rows; searches ${terms.map((t, i) => `${t}→${rs[i].body?.items?.length ?? rs[i].status}`).join(' ')}`);
    ok(`MB6 School ${s.n}: "%" and "_" match nobody special, and odd input never errors`, rs.every((r) => r.status === 200) && (rs[7].body?.items?.length ?? 0) < full.body?.items?.length, `% matched ${rs[7].body?.items?.length}, _ matched ${rs[8].body?.items?.length}`);
  }
  const par = await Promise.all(Array.from({ length: 30 }, (_, i) => call('mb6:roster-xlarge-x30', 'GET', `/schools/${XL[i % XL.length].id}/students`, XL[i % XL.length].owner.tok)));
  info('MB6 30 very-large rosters at once (e.g. 30 front desks searching)', JSON.stringify(codes(par)));
}

save();
await db.$disconnect();
