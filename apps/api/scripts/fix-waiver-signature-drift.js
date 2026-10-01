/**
 * One-off remediation — NOT part of the app's real code, not run in CI.
 *
 * WaiverSignature.signedById is a NOT NULL column that exists on the live dev DB
 * but was never created by any migration this branch or master has ever run
 * against it (confirmed via check-migration-drift.js's _prisma_migrations read —
 * someone added it by hand, directly, at some point). It isn't just blocking the
 * seed script: schema.prisma/Prisma Client have no idea it exists, so
 * WaiversService's real sign-a-waiver endpoint doesn't supply it either — meaning
 * any ACTUAL caller hitting that endpoint right now hits this same NOT NULL
 * violation. This is a live bug, not just a seed inconvenience.
 *
 * Deliberately a plain DROP COLUMN, not a new Prisma migration file: nothing in
 * this branch's tracked migration history ever added the column, so there is
 * nothing for a migration to "undo" — adding one would misrepresent this
 * branch's own history as having created something it didn't.
 *
 * Prints what's actually in the column first (row count + values) so dropping it
 * is an informed call, not a blind one, before doing it.
 *
 * Usage (from apps/api): DATABASE_URL='...' node scripts/fix-waiver-signature-drift.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, "studentId", "signedById", "signedDate", status FROM "WaiverSignature"`,
  );
  console.log(`WaiverSignature currently has ${rows.length} row(s):`);
  console.log(JSON.stringify(rows, null, 2));

  console.log('\nDropping the orphaned "signedById" column...');
  await prisma.$executeRawUnsafe(`ALTER TABLE "WaiverSignature" DROP COLUMN "signedById"`);

  const [check] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'WaiverSignature' AND column_name = 'signedById'
     ) AS still_there`,
  );
  console.log('signedById still present after drop:', check.still_there);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
