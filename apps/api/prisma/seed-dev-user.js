/**
 * One-off local-dev seed — NOT part of the app's real code, not run in CI, not
 * referenced by package.json. Exists solely to unblock manually browsing
 * apps/school-portal without a live Twilio account: inserts a School-Owner-Manager
 * User that has already passed the Register -> Verify-OTP flow (phoneVerifiedAt set),
 * the same way AuthService.login() expects (bcrypt-hashed passcode, BCRYPT_ROUNDS=12
 * per auth.service.ts), plus an owned School and the RoleGrant that makes
 * useOwnedSchoolId() route /  -> /school instead of /onboarding.
 *
 * Run once against the local dev DB: node prisma/seed-dev-user.js
 * Login with: dev@ultm8.local / 123456
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12; // matches apps/api/src/auth/auth.service.ts

async function main() {
  const passcodeHash = await bcrypt.hash('123456', BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: 'dev@ultm8.local' },
    update: {},
    create: {
      email: 'dev@ultm8.local',
      phone: '+15550000001',
      firstName: 'Dev',
      surname: 'Owner',
      passcodeHash,
      phoneVerifiedAt: new Date(), // skips the OTP gate in AuthService.login()
      dateOfBirth: new Date('1990-01-01'),
    },
  });

  const school = await prisma.school.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Dev Test School',
    },
  });

  await prisma.roleGrant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      role: 'SCHOOL_OWNER_MANAGER',
      userId: user.id,
      schoolId: school.id,
    },
  });

  console.log('Seeded dev user: dev@ultm8.local / 123456 (owns "Dev Test School")');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
