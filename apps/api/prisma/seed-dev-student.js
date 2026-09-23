/**
 * One-off local-dev seed — NOT part of the app's real code, not run in CI, not
 * referenced by package.json. Adapted from prisma/seed-dev-user.js (docs/track-a-
 * roadmap), which seeds a SCHOOL_OWNER_MANAGER for apps/school-portal — this seeds
 * a STUDENT instead, to unblock manually browsing apps/student without a live
 * Twilio account. Inserts a User that has already passed the Register ->
 * Verify-OTP flow (phoneVerifiedAt set), the same way AuthService.login() expects
 * (bcrypt-hashed passcode, BCRYPT_ROUNDS=12 per auth.service.ts), plus a School and
 * the STUDENT RoleGrant that useEnrolledSchoolIds() (apps/student/src/auth/
 * AuthContext.tsx) reads to decide which School(s) the Student is enrolled at.
 *
 * Run once against the real dev DB (needs actual Postgres network access — e.g.
 * from a GitHub Codespace terminal, with DATABASE_URL set to the Supabase
 * superuser connection string): node prisma/seed-dev-student.js
 * Login with: student@ultm8.local / 123456
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12; // matches apps/api/src/auth/auth.service.ts

async function main() {
  const passcodeHash = await bcrypt.hash('123456', BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: 'student@ultm8.local' },
    update: {},
    create: {
      email: 'student@ultm8.local',
      phone: '+15550000002',
      firstName: 'Dev',
      surname: 'Student',
      passcodeHash,
      phoneVerifiedAt: new Date(), // skips the OTP gate in AuthService.login()
      dateOfBirth: new Date('2000-01-01'),
    },
  });

  const school = await prisma.school.upsert({
    where: { id: '00000000-0000-0000-0000-000000000011' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Dev Test School (Student)',
    },
  });

  await prisma.roleGrant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000012' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000012',
      role: 'STUDENT',
      userId: user.id,
      schoolId: school.id,
    },
  });

  console.log('Seeded dev student: student@ultm8.local / 123456 (enrolled at "Dev Test School (Student)")');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
