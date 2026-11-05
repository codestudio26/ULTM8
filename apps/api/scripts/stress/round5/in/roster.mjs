// Roster, search, export, Branch Staff scope at 4,000 students. Read-only.
import fs from 'fs';
import { db, call, grant, tokenRca, report, pool } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const S = C.schoolId;
const tOwner = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const out = {};
const time = async (label, n, fn) => { const ms = []; let last; for (let i = 0; i < n; i++) { const t = performance.now(); last = await fn(); ms.push(performance.now() - t); } ms.sort((a, b) => a - b); return { label, p50: ms[Math.floor(n / 2)] | 0, max: ms[n - 1] | 0, status: last.status, kb: Math.round((last.bytes || 0) / 1024), last }; };

// R1 roster as owner
const r1 = await time('roster-owner', 5, () => call('roster', 'GET', `/schools/${S}/students`, tOwner));
out.R1 = { ...r1, rows: r1.last.body?.items?.length, last: undefined };
const r1all = await time('roster-owner-ALL', 3, () => call('roster-all', 'GET', `/schools/${S}/students?status=ALL`, tOwner));
out.R1all = { ...r1all, rows: r1all.last.body?.items?.length, last: undefined };
// 16 front desks at once
const par = await Promise.all(Array.from({ length: 16 }, () => call('roster-x16', 'GET', `/schools/${S}/students`, tOwner)));
out.R1par = par.map((r) => r.status).join(',');

// R2 search
const terms = { venkat: 'Venkat', initials: 'K. R.', initialsNoDots: 'KR Venkat', initialsSpaced: 'K R Venkataraghavan', fullname: 'Venkataraghavan Subramanian', reversed: 'Subramanian Venkataraghavan', deva: 'शर्मा', devaFirst: 'आरव', tamil: 'சுப்பிரமணியன்', tamilPart: 'கார்த்', zoyaPrecomposed: 'ज़ोया', zoyaDecomposed: 'ज़ोया'.normalize('NFC'), khanNFD: 'ख़ान'.normalize('NFD'), khanNFC: 'ख़ान'.normalize('NFC'), mono: 'Venkataraghavan .', dsouza: "D'Souza", dsouzaCurly: 'D’Souza', email: C.students[10].email, phone: (C.students.find((s) => s.phone) || {}).phone, pct: '%', underscore: '_', inj: "'; drop table \"User\"; --", emoji: '🥋', huge: 'a'.repeat(5000) };
out.R2 = {};
for (const [k, q] of Object.entries(terms)) {
  const r = await call('search', 'GET', `/schools/${S}/students?search=${encodeURIComponent(q)}`, tOwner);
  out.R2[k] = { q: q.length > 40 ? q.slice(0, 20) + '…' : q, status: r.status, n: r.body?.items?.length, sample: r.body?.items?.slice(0, 2).map((x) => `${x.firstName}|${x.surname}`) };
}
// expected counts from cast
const cnt = (f) => C.students.filter(f).length;
out.R2expect = { zoyaInCast: cnt((s) => s.first.includes('ज़ोया') || s.first.includes('ज़ोया')), khan: cnt((s) => s.last.normalize('NFC') === 'ख़ान'.normalize('NFC')), venkatInitials: cnt((s) => s.first.startsWith('K. R.')) };
out.codepoints = { stored: [...C.students.find((s) => s.last.startsWith('ख'))?.last || ''].map((c) => c.codePointAt(0).toString(16)), nfc: [...'ख़ान'.normalize('NFC')].map((c) => c.codePointAt(0).toString(16)) };

// R3 export
const ex = await time('export-owner', 3, () => call('export', 'GET', `/schools/${S}/students/export`, tOwner));
const items = ex.last.body?.items || [];
out.R3 = { ...ex, rows: items.length, last: undefined, mono: items.find((i) => i.firstName === 'Venkataraghavan' && i.surname === '.'), deva: items.find((i) => i.firstName === 'आरव')?.surname, leap: items.find((i) => i.firstName === 'Leap')?.dateOfBirth, keys: Object.keys(items[0] || {}) };
const exAll = await call('export-all', 'GET', `/schools/${S}/students/export?filter=ALL`, tOwner);
out.R3all = { status: exAll.status, rows: exAll.body?.items?.length, kb: Math.round(exAll.bytes / 1024) };

// R4 Branch Staff: each sees only their Branch
out.R4 = [];
for (const st of C.bstaff) {
  const t = tokenRca(st, [grant('BRANCH_STAFF', S, st.branchId)]);
  const t0 = performance.now();
  const r = await call('roster-staff', 'GET', `/schools/${S}/students`, t);
  const ms = performance.now() - t0;
  const ids = new Set((r.body?.items || []).map((i) => i.id));
  const mine = C.students.filter((s) => s.branch === st.branchId && s.home).map((s) => s.id);
  const others = C.students.filter((s) => s.branch !== st.branchId).filter((s) => ids.has(s.id)).length;
  const missing = mine.filter((id) => !ids.has(id)).length;
  out.R4.push({ status: r.status, ms: ms | 0, rows: ids.size, expected: mine.length, otherBranchVisible: others, missing });
}
// staff export and other-branch profile
{
  const st = C.bstaff[0]; const t = tokenRca(st, [grant('BRANCH_STAFF', S, st.branchId)]);
  const e = await call('export-staff', 'GET', `/schools/${S}/students/export`, t);
  const eIds = new Set((e.body?.items || []).map((i) => i.id));
  const other = C.students.find((s) => s.branch !== st.branchId);
  const prof = await call('profile-other-branch', 'GET', `/schools/${S}/students/${other.id}/profile`, t);
  const code = await call('code-other-branch', 'GET', `/schools/${S}/students/${other.id}/check-in-code`, t);
  const homeless = C.students.find((s) => !s.home && s.branch === st.branchId);
  const srch = await call('search-staff-other', 'GET', `/schools/${S}/students?search=${encodeURIComponent(other.first)}`, t);
  const leak = (srch.body?.items || []).filter((i) => C.students.find((s) => s.id === i.id)?.branch !== st.branchId).length;
  out.R4b = { exportStatus: e.status, exportRows: eIds.size, exportOtherBranch: C.students.filter((s) => s.branch !== st.branchId && eIds.has(s.id)).length, profileOther: prof.status, codeOther: code.status, homelessVisibleInRoster: null, searchLeak: leak };
}
fs.writeFileSync(new URL('./roster-result.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
report();
await db.$disconnect();
