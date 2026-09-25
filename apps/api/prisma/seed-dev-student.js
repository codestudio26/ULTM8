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

  // ---------------------------------------------------------------------
  // Below: populated data so every Student-app screen has something to show
  // instead of an empty state (see the task this script was extended for).
  // All ids are fixed (upsert-by-id, same idempotent pattern as User/School/
  // RoleGrant above) so re-running this script is always safe.
  // ---------------------------------------------------------------------

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // --- 1. Discipline + ordered Rank ladder + RankStripeTiers + StudentRank ---
  // "Jiu Jitsu" doubles as the Discipline name AND the string put in Class.activities
  // below (BookingsService.assertRankEligible matches Discipline.name against
  // Class.activities, apps/api/src/bookings/bookings.service.ts) — deliberately kept
  // identical so this seed data is internally consistent for that gate once the
  // separate Bookings 500 bug is fixed.
  const discipline = await prisma.discipline.upsert({
    where: { id: '00000000-0000-0000-0000-000000000021' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000021',
      schoolId: school.id,
      name: 'Jiu Jitsu',
      classTypesOffered: ['Fundamentals', 'Sparring'],
    },
  });

  const rankWhite = await prisma.rank.upsert({
    where: { id: '00000000-0000-0000-0000-000000000022' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000022',
      disciplineId: discipline.id,
      schoolId: school.id,
      order: 0,
      primaryColour: 'White',
    },
  });

  const rankBlue = await prisma.rank.upsert({
    where: { id: '00000000-0000-0000-0000-000000000023' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000023',
      disciplineId: discipline.id,
      schoolId: school.id,
      order: 1,
      primaryColour: 'Blue',
    },
  });

  const rankBlack = await prisma.rank.upsert({
    where: { id: '00000000-0000-0000-0000-000000000024' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000024',
      disciplineId: discipline.id,
      schoolId: school.id,
      order: 2,
      primaryColour: 'Black',
      yearsInRankFlag: true, // Black Belt+ gates on tenure, not classes/days (SKILL.md §5)
    },
  });

  // eligibleClassTypes deliberately matches the Discipline name / Class.activities
  // string used below, on every tier, so a Student already at or past White-0 (i.e.
  // everyone, since it's the very first checkpoint) is eligible for the seeded
  // Classes' "Jiu Jitsu" activity once real rank-gated booking is exercised.
  const tierWhite0 = await prisma.rankStripeTier.upsert({
    where: { id: '00000000-0000-0000-0000-000000000025' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000025',
      rankId: rankWhite.id,
      schoolId: school.id,
      order: 0,
      count: 1,
      colour: 'Black',
      classesRequired: 20,
      minimumDaysInRank: 60,
      eligibleClassTypes: ['Jiu Jitsu'],
    },
  });

  await prisma.rankStripeTier.upsert({
    where: { id: '00000000-0000-0000-0000-000000000026' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000026',
      rankId: rankWhite.id,
      schoolId: school.id,
      order: 1,
      count: 2,
      colour: 'Black',
      classesRequired: 20,
      minimumDaysInRank: 60,
      eligibleClassTypes: ['Jiu Jitsu'],
    },
  });

  const tierBlue0 = await prisma.rankStripeTier.upsert({
    where: { id: '00000000-0000-0000-0000-000000000027' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000027',
      rankId: rankBlue.id,
      schoolId: school.id,
      order: 0,
      count: 1,
      colour: 'White',
      classesRequired: 30,
      minimumDaysInRank: 90,
      eligibleClassTypes: ['Jiu Jitsu'],
    },
  });

  await prisma.rankStripeTier.upsert({
    where: { id: '00000000-0000-0000-0000-000000000028' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000028',
      rankId: rankBlue.id,
      schoolId: school.id,
      order: 1,
      count: 2,
      colour: 'White',
      classesRequired: 30,
      minimumDaysInRank: 90,
      eligibleClassTypes: ['Jiu Jitsu'],
    },
  });

  await prisma.rankStripeTier.upsert({
    where: { id: '00000000-0000-0000-0000-000000000029' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000029',
      rankId: rankBlack.id,
      schoolId: school.id,
      order: 0,
      count: 1,
      colour: 'Red',
      // classesRequired/minimumDaysInRank intentionally null — Black Belt+ gates on
      // yearsInRankFlag only (see rankBlack above; SKILL.md §5, schema.prisma's own
      // Rank/RankStripeTier header comments).
      eligibleClassTypes: ['Jiu Jitsu'],
    },
  });

  // Student sits partway through Blue (the middle rank), at Blue's first stripe
  // tier, with some but not all of the classes toward its next checkpoint attended —
  // readiness bucket/progress % are deliberately NOT set: they're computed-not-stored
  // per StudentRank's own schema.prisma header comment (Decision 75), not real columns.
  await prisma.studentRank.upsert({
    where: { studentId_disciplineId: { studentId: user.id, disciplineId: discipline.id } },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000030',
      studentId: user.id,
      disciplineId: discipline.id,
      schoolId: school.id,
      currentRankId: rankBlue.id,
      currentStripeId: tierBlue0.id,
      dateOfCurrentRank: new Date(now - 90 * DAY_MS),
      classesAttendedTowardCheckpoint: 12, // partway toward tierBlue0's classesRequired: 30
    },
  });

  // --- 2. MembershipPlan (Subscription) + an ACTIVE Membership for the student ---
  const membershipPlan = await prisma.membershipPlan.upsert({
    where: { id: '00000000-0000-0000-0000-000000000031' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000031',
      schoolId: school.id,
      type: 'SUBSCRIPTION',
      title: 'Unlimited Monthly Membership',
      price: 9900, // minor-unit (cents) — $99.00, matches MembershipPlan's own money-field convention
      currency: 'USD',
      visible: true, // AcademiesService.findOne only returns visible: true plans (academies.service.ts)
    },
  });

  const membership = await prisma.membership.upsert({
    where: { id: '00000000-0000-0000-0000-000000000032' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000032',
      studentId: user.id,
      membershipPlanId: membershipPlan.id,
      schoolId: school.id,
      status: 'ACTIVE', // MembershipStatus is Active/Expired ONLY — Decision 6, no Pending value
      startDate: new Date(now - 30 * DAY_MS),
      frequency: 'RECURRING', // matches a Subscription-type plan (SKILL.md §7)
    },
  });

  // --- 3. Classes at the school (activities matching the Discipline above) ---
  const classPast = await prisma.class.upsert({
    where: { id: '00000000-0000-0000-0000-000000000033' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000033',
      schoolId: school.id,
      title: 'Jiu Jitsu Fundamentals',
      activities: ['Jiu Jitsu'],
      description: 'Beginner-friendly fundamentals class.',
      startDate: new Date(now - 14 * DAY_MS),
      endDate: new Date(now - 14 * DAY_MS + 60 * 60 * 1000),
      capacity: 20,
      membershipInclusion: true, // covered by the Subscription above, not a scoped ticket
    },
  });

  const classUpcoming = await prisma.class.upsert({
    where: { id: '00000000-0000-0000-0000-000000000034' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000034',
      schoolId: school.id,
      title: 'Jiu Jitsu All Levels Sparring',
      activities: ['Jiu Jitsu'],
      description: 'Open-mat sparring for all belt levels.',
      startDate: new Date(now + 3 * DAY_MS),
      endDate: new Date(now + 3 * DAY_MS + 60 * 60 * 1000),
      capacity: 20,
      bookingEndAt: new Date(now + 3 * DAY_MS - 2 * 60 * 60 * 1000),
      membershipInclusion: true,
    },
  });

  await prisma.class.upsert({
    where: { id: '00000000-0000-0000-0000-000000000035' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000035',
      schoolId: school.id,
      title: 'Jiu Jitsu Competition Team',
      activities: ['Jiu Jitsu'],
      description: 'Competition-focused training session.',
      startDate: new Date(now + 10 * DAY_MS),
      endDate: new Date(now + 10 * DAY_MS + 90 * 60 * 1000),
      capacity: 12,
      bookingEndAt: new Date(now + 10 * DAY_MS - 2 * 60 * 60 * 1000),
      membershipInclusion: true,
    },
  });

  // --- 4. Bookings for the student — one past/Completed, one future/Upcoming ---
  await prisma.booking.upsert({
    where: { id: '00000000-0000-0000-0000-000000000036' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000036',
      studentId: user.id,
      classId: classPast.id,
      schoolId: school.id,
      status: 'COMPLETED',
      sourceMembershipId: membership.id,
    },
  });

  await prisma.booking.upsert({
    where: { id: '00000000-0000-0000-0000-000000000037' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000037',
      studentId: user.id,
      classId: classUpcoming.id,
      schoolId: school.id,
      status: 'UPCOMING', // default anyway; set explicitly since this is the main "populate" case
      sourceMembershipId: membership.id,
    },
  });

  // --- 5. Notifications, mixed read/unread ---
  await prisma.notification.upsert({
    where: { id: '00000000-0000-0000-0000-000000000038' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000038',
      userId: user.id,
      title: 'Welcome to Dev Test School (Student)!',
      body: 'Your enrollment is confirmed — check out upcoming classes and your membership plan.',
      read: true,
      createdAt: new Date(now - 20 * DAY_MS),
    },
  });

  await prisma.notification.upsert({
    where: { id: '00000000-0000-0000-0000-000000000039' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000039',
      userId: user.id,
      title: 'Booking confirmed',
      body: `You're booked for "${classUpcoming.title}".`,
      read: false,
      createdAt: new Date(now - 2 * DAY_MS),
    },
  });

  await prisma.notification.upsert({
    where: { id: '00000000-0000-0000-0000-000000000040' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000040',
      userId: user.id,
      title: 'New membership plan available',
      body: 'Check out the Unlimited Monthly Membership at Dev Test School (Student).',
      read: false,
      createdAt: new Date(now - 1 * DAY_MS),
    },
  });

  // --- 6. Waiver + a Signed WaiverSignature for the student ---
  const waiver = await prisma.waiver.upsert({
    where: { id: '00000000-0000-0000-0000-000000000041' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000041',
      schoolId: school.id,
      title: 'Liability & Assumption of Risk Waiver',
      body: 'By signing, I acknowledge the risks of martial-arts training and release Dev Test School (Student) from liability for injury.',
    },
  });

  await prisma.waiverSignature.upsert({
    where: { id: '00000000-0000-0000-0000-000000000042' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000042',
      waiverId: waiver.id,
      studentId: user.id,
      schoolId: school.id,
      signerFullName: 'Dev Student',
      signatureText: 'Dev Student', // typed-name mechanism — see WaiverSignature's own schema.prisma comment
      signedDate: new Date(now - 30 * DAY_MS),
      status: 'SIGNED',
    },
  });

  console.log('Seeded dev student: student@ultm8.local / 123456 (enrolled at "Dev Test School (Student)")');
  console.log('Also seeded: 1 Discipline (3 Ranks / 5 RankStripeTiers) + StudentRank, 1 MembershipPlan + Membership, 3 Classes, 2 Bookings, 3 Notifications, 1 Waiver + WaiverSignature.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
