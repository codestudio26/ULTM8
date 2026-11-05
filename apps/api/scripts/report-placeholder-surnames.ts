import { PrismaClient } from '@prisma/client';

/**
 * Decision 433 (TXT-8): a one-off, read-only report for School owners of the
 * people whose surname is only a placeholder (".", "-" or "_"), typed before
 * the "Has only one name" tick existed. Nothing is changed: each owner opens
 * the person's profile, ticks "Has only one name" and saves, or types the
 * real surname.
 *
 * One CSV row per person and School they belong to: School, School id, the
 * School's owner emails, the person's first name, surname as stored, user id
 * and roles there. Run from apps/api against the production database
 * (DATABASE_URL, a role that can read every School):
 *   npx ts-node -r tsconfig-paths/register scripts/report-placeholder-surnames.ts > placeholder-surnames.csv
 */
const PLACEHOLDERS = ['.', '-', '_'];

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<Array<{ schoolName: string; schoolId: string; owners: string | null; firstName: string; surname: string; userId: string; roles: string }>>`
      SELECT s."name" AS "schoolName", s."id" AS "schoolId",
             (SELECT string_agg(DISTINCT ou."email", '; ')
                FROM "RoleGrant" og JOIN "User" ou ON ou."id" = og."userId"
               WHERE og."schoolId" = s."id" AND og."role" = 'SCHOOL_OWNER_MANAGER' AND og."revokedAt" IS NULL) AS "owners",
             u."firstName", u."surname", u."id" AS "userId",
             string_agg(DISTINCT g."role"::text, '; ') AS "roles"
        FROM "User" u
        JOIN "RoleGrant" g ON g."userId" = u."id" AND g."revokedAt" IS NULL AND g."schoolId" IS NOT NULL
        JOIN "School" s ON s."id" = g."schoolId"
       WHERE btrim(u."surname") = ANY(${PLACEHOLDERS})
       GROUP BY s."id", s."name", u."id", u."firstName", u."surname"
       ORDER BY s."name", u."firstName"`;
    const lines = [['School', 'School id', 'Owners', 'First name', 'Surname as stored', 'User id', 'Roles']];
    for (const r of rows) lines.push([r.schoolName, r.schoolId, r.owners ?? '', r.firstName, r.surname, r.userId, r.roles]);
    process.stdout.write(`${lines.map((l) => l.map(cell).join(',')).join('\n')}\n`);
    // eslint-disable-next-line no-console
    console.error(`${rows.length} people with a placeholder surname.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
