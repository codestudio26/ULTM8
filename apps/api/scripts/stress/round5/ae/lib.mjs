import fs from 'fs';
export * from '../../round4/common.mjs';
import { grant, tokenRca } from '../../round4/common.mjs';
export const C = JSON.parse(fs.readFileSync(new URL('./ae-cast.json', import.meta.url)));
export const tk = (u, role, branchId = null, schoolId = C.school) => tokenRca(u, [grant(role, schoolId, branchId)]);
export const saveCast = () => fs.writeFileSync(new URL('./ae-cast.json', import.meta.url), JSON.stringify(C, null, 1));
export const S = C.school;
export const short = (x, n = 300) => JSON.stringify(x)?.slice(0, n);
