// Helper: one API call as Mike (owner). node q.mjs METHOD PATH [json]
import fs from 'fs';
import { call, grant, tokenRca } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-us.json', import.meta.url)));
const t = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', C.schoolId)]);
const [m, p, b] = process.argv.slice(2);
const r = await call('q', m, p.replace('{S}', C.schoolId), t, b ? JSON.parse(b) : undefined);
console.log(r.status, JSON.stringify(r.body, null, 1).slice(0, Number(process.env.MAX || 3000)));
process.exit(0);
