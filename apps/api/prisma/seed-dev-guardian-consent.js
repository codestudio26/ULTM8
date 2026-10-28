/**
 * One-off local-dev seed — NOT part of the app's real code, not run in CI, not
 * referenced by package.json. Exists solely to populate data for a design
 * review of the Track B Guardian consent-management screens
 * (apps/student/src/guardians/{MyMinorsScreen,MinorConsentScreen,ConsentTierRow}.tsx):
 * a Guardian User, a linked minor Student User (GuardianLink), and one
 * ConsentRecord per ConsentTier (BASELINE granted/Active so the step-up
 * withdrawal prompt can be exercised; CAMERA also granted/Active so both tiers
 * are visible on MinorConsentScreen).
 *
 * Modeled directly on this directory's own seed-dev-user.js: bcrypt-hash a
 * passcode (BCRYPT_ROUNDS=12, matching apps/api/src/auth/auth.service.ts),
 * phoneVerifiedAt set to skip the OTP gate AuthService.login() checks.
 *
 * Run once against the local dev DB: node prisma/seed-dev-guardian-consent.js
 * Login as the Guardian with: guardian-dev@ultm8.local / 123456
 */
// Refuses to run against a non-local database — see dev-seed-guard.js.
require('./dev-seed-guard').assertDevDatabase('seed-dev-guardian-consent.js');

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12; // matches apps/api/src/auth/auth.service.ts

const CURRENT_POLICY_VERSION = '1.0-placeholder'; // matches ConsentTierRow.tsx's own placeholder

async function main() {
  const passcodeHash = await bcrypt.hash('123456', BCRYPT_ROUNDS);

  // --- Guardian User (adult account, own login) ---
  const guardian = await prisma.user.upsert({
    where: { email: 'guardian-dev@ultm8.local' },
    update: {},
    create: {
      email: 'guardian-dev@ultm8.local',
      phone: '+15550000101',
      firstName: 'Gail',
      surname: 'Guardian',
      passcodeHash,
      phoneVerifiedAt: new Date(), // skips the OTP gate in AuthService.login()
      dateOfBirth: new Date('1985-04-12'),
    },
  });

  // Guardian needs a GUARDIAN RoleGrant for useIsGuardian()/HomeScreen's "My
  // minors" button to show at all (RoleGrant is the sole source of role
  // truth — domain-rules §3). Not school-scoped: GuardianLink/ConsentRecord
  // are platform-scoped, not School-scoped (SKILL.md §14).
  await prisma.roleGrant.upsert({
    where: { id: '00000000-0000-4000-8000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000101',
      role: 'GUARDIAN',
      userId: guardian.id,
    },
  });

  // --- Minor Student User (no independent login by default — SKILL.md §14) ---
  const minor = await prisma.user.upsert({
    where: { email: 'minor-dev@ultm8.local' },
    update: {},
    create: {
      email: 'minor-dev@ultm8.local',
      phone: '+15550000102',
      firstName: 'Milo',
      surname: 'Minor',
      passcodeHash, // unused (no independent login), kept non-null since the column is required
      phoneVerifiedAt: new Date(),
      dateOfBirth: new Date('2015-06-01'),
    },
  });

  // --- A second minor, so MyMinorsScreen's list view has more than one row ---
  const minor2 = await prisma.user.upsert({
    where: { email: 'minor2-dev@ultm8.local' },
    update: {},
    create: {
      email: 'minor2-dev@ultm8.local',
      phone: '+15550000103',
      firstName: 'Nora',
      surname: 'Minor',
      passcodeHash,
      phoneVerifiedAt: new Date(),
      dateOfBirth: new Date('2017-09-20'),
    },
  });

  // --- GuardianLink: guardian <-> each minor ---
  await prisma.guardianLink.upsert({
    where: { guardianId_studentId: { guardianId: guardian.id, studentId: minor.id } },
    update: { revokedAt: null },
    create: {
      guardianId: guardian.id,
      studentId: minor.id,
    },
  });
  await prisma.guardianLink.upsert({
    where: { guardianId_studentId: { guardianId: guardian.id, studentId: minor2.id } },
    update: { revokedAt: null },
    create: {
      guardianId: guardian.id,
      studentId: minor2.id,
    },
  });

  // --- ConsentRecord: one per tier for the first minor, both Active, so
  // MinorConsentScreen shows both tiers as granted (BASELINE withdrawal is
  // then exercised live in the browser to trigger the step-up prompt). ---
  await prisma.consentRecord.upsert({
    where: { guardianId_studentId_tier: { guardianId: guardian.id, studentId: minor.id, tier: 'BASELINE' } },
    update: { status: 'ACTIVE', withdrawnAt: null },
    create: {
      guardianId: guardian.id,
      studentId: minor.id,
      tier: 'BASELINE',
      policyVersion: CURRENT_POLICY_VERSION,
      status: 'ACTIVE',
    },
  });
  await prisma.consentRecord.upsert({
    where: { guardianId_studentId_tier: { guardianId: guardian.id, studentId: minor.id, tier: 'CAMERA' } },
    update: { status: 'ACTIVE', withdrawnAt: null },
    create: {
      guardianId: guardian.id,
      studentId: minor.id,
      tier: 'CAMERA',
      policyVersion: CURRENT_POLICY_VERSION,
      status: 'ACTIVE',
    },
  });

  // Second minor: only BASELINE granted (CAMERA left ungranted) so the
  // "Grant consent" (ungranted) state is also visible somewhere in the seed.
  await prisma.consentRecord.upsert({
    where: { guardianId_studentId_tier: { guardianId: guardian.id, studentId: minor2.id, tier: 'BASELINE' } },
    update: { status: 'ACTIVE', withdrawnAt: null },
    create: {
      guardianId: guardian.id,
      studentId: minor2.id,
      tier: 'BASELINE',
      policyVersion: CURRENT_POLICY_VERSION,
      status: 'ACTIVE',
    },
  });

  console.log('Seeded Guardian consent-review fixtures:');
  console.log('  Guardian login: guardian-dev@ultm8.local / 123456');
  console.log(`  Minor 1 (both tiers Active): ${minor.firstName} ${minor.surname} (${minor.id})`);
  console.log(`  Minor 2 (BASELINE only):     ${minor2.firstName} ${minor2.surname} (${minor2.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
