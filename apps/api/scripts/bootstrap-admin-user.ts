import { PrismaClient, AdminSubRole } from '@prisma/client';

/**
 * One-time, out-of-band bootstrap for the very first Platform Admin account.
 * PlatformAdminModule's own login flow (POST /platform-admin/auth/exchange) only
 * ever MATCHES an existing AdminUser row by its Cognito `sub` — there is
 * deliberately no self-service signup (ultm8-tenant-isolation SKILL.md §3: "Full
 * Platform Admin — the only tier that can assign sub-roles to other staff"), which
 * means the FIRST AdminUser row has no FULL_ADMIN yet to create it through the app.
 * This script is that one-time exception — run it directly against Postgres, not
 * through the API, and only for the very first account. Every AdminUser after this
 * one should be created by a FULL_ADMIN through a real invite flow once that later
 * slice exists (see PlatformAdminModule's own header comment on what's deliberately
 * not built yet) — this script is not a general-purpose admin-creation tool and
 * should not become the standing way new admins get added.
 *
 * Usage (run from apps/api):
 *   npx ts-node -r tsconfig-paths/register scripts/bootstrap-admin-user.ts \
 *     --email you@ultm8.example --name "Your Name" --subRole FULL_ADMIN --ssoSubject <cognito-sub>
 *
 * `--ssoSubject` is Cognito's own `sub` claim for the account being bootstrapped —
 * obtain it by first creating the Cognito user (AWS Console, or
 * `aws cognito-idp admin-create-user`) and either reading the returned `sub`
 * attribute directly or decoding it from that user's own first ID token. This
 * script does NOT create the Cognito user itself — identity (Cognito) and
 * authorization (this AdminUser row) are deliberately provisioned as two separate
 * steps, in that order, not one combined action.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['email', 'name', 'subRole', 'ssoSubject'] as const) {
    if (!args[required]) {
      // eslint-disable-next-line no-console
      console.error(`Missing required --${required}`);
      process.exit(1);
    }
  }
  if (!Object.values(AdminSubRole).includes(args.subRole as AdminSubRole)) {
    // eslint-disable-next-line no-console
    console.error(`--subRole must be one of: ${Object.values(AdminSubRole).join(', ')}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL_APP;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL_APP is not set.');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasourceUrl: url });

  const existingCount = await prisma.adminUser.count();
  if (existingCount > 0 && args.subRole === 'FULL_ADMIN') {
    // eslint-disable-next-line no-console
    console.warn(
      `${existingCount} AdminUser row(s) already exist. This script is meant for the very first bootstrap only — ` +
        'if you\'re adding a subsequent admin, prefer the app\'s own invite flow once it exists rather than this script.',
    );
  }

  const admin = await prisma.adminUser.create({
    data: {
      email: args.email,
      name: args.name,
      subRole: args.subRole as AdminSubRole,
      ssoSubject: args.ssoSubject,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Created AdminUser ${admin.id} (${admin.email}, ${admin.subRole}).`);
  await prisma.$disconnect();
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key && value) out[key] = value;
  }
  return out;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
