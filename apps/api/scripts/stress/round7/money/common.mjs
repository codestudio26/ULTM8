// Loads cast.json (setup.mjs) and signs its owners in again.
import fs from 'fs';
import { createRequire } from 'module';
import { signIn, db } from './lib.mjs';
export const cast = JSON.parse(fs.readFileSync(new URL('./cast.json', import.meta.url)));
export async function school(k) {
  const s = { ...cast[k], id: cast[k].schoolId, branch: { id: cast[k].branchId }, payAcct: { id: cast[k].payAcctId } };
  await signIn(s.owner);
  return s;
}
// The API's own compiled code, for the race tests that call a job's inner
// function twice at the same moment (one worker runs jobs one at a time).
const require = createRequire(new URL('../../../../package.json', import.meta.url));
export const dist = (p) => require(new URL(`../../../../dist/${p}.js`, import.meta.url).pathname);
const { PrismaClient } = require('@prisma/client');
export const jobsDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_JOBS });
export async function done() { await db.$disconnect(); await jobsDb.$disconnect(); process.exit(0); }
