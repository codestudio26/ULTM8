/**
 * One-off local-dev seed — NOT part of the app's real code, not run in CI, not
 * referenced by package.json. Companion to seed-dev-user.js: that script alone
 * gets you a working login but every list screen in both apps.student and
 * apps.school-portal is still empty, which makes the UI hard to actually look
 * at. This script fills in realistic fixture rows across the board (Branches,
 * an Instructor, a second Student, a Discipline + two Ranks, two Classes, a
 * Timetable slot, a Curriculum category + lesson, three Membership Plans, two
 * Memberships, three Transactions, a Waiver with one signed/one unsigned
 * signature, a Booking, and four Notifications) so every previously-blank
 * page has something real to render.
 *
 * Idempotent (every row upserts on a fixed id) and self-sufficient — it
 * upserts the dev@ultm8.local user/School itself, so it can run standalone or
 * after seed-dev-user.js with the same end result either way.
 *
 * Run once against the local dev DB: node prisma/seed-dummy-data.js
 * Login with: dev@ultm8.local / 123456 (now also enrolled as a Student,
 * on top of owning "Dev Test School"), or coach.alex@ultm8.local / 123456
 * (Instructor), or jamie.lee@ultm8.local / 123456 (Student).
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12; // matches apps/api/src/auth/auth.service.ts
const SCHOOL_ID = '00000000-0000-4000-8000-000000000001'; // Dev Test School, from seed-dev-user.js

async function main() {
  const devPasscode = await bcrypt.hash('123456', BCRYPT_ROUNDS);
  const devUser = await prisma.user.upsert({
    where: { email: 'dev@ultm8.local' },
    update: {},
    create: {
      email: 'dev@ultm8.local',
      phone: '+15550000001',
      firstName: 'Dev',
      surname: 'Owner',
      passcodeHash: devPasscode,
      phoneVerifiedAt: new Date(),
      dateOfBirth: new Date('1990-01-01'),
    },
  });
  await prisma.school.upsert({
    where: { id: SCHOOL_ID },
    update: {},
    create: { id: SCHOOL_ID, name: 'Dev Test School' },
  });
  await prisma.roleGrant.upsert({
    where: { id: '00000000-0000-4000-8000-000000000002' },
    update: {},
    create: { id: '00000000-0000-4000-8000-000000000002', role: 'SCHOOL_OWNER_MANAGER', userId: devUser.id, schoolId: SCHOOL_ID },
  });

  // --- Give the dev user a Student grant too (owner who also trains) ---
  await prisma.roleGrant.upsert({
    where: { id: '10000000-0000-4000-8000-000000000001' },
    update: {},
    create: { id: '10000000-0000-4000-8000-000000000001', role: 'STUDENT', userId: devUser.id, schoolId: SCHOOL_ID },
  });

  // --- A second user: Instructor ---
  const instructorPasscode = await bcrypt.hash('123456', BCRYPT_ROUNDS);
  const instructorUser = await prisma.user.upsert({
    where: { email: 'coach.alex@ultm8.local' },
    update: {},
    create: {
      email: 'coach.alex@ultm8.local',
      phone: '+15550000002',
      firstName: 'Alex',
      surname: 'Rivera',
      passcodeHash: instructorPasscode,
      phoneVerifiedAt: new Date(),
      dateOfBirth: new Date('1988-04-12'),
    },
  });
  await prisma.roleGrant.upsert({
    where: { id: '10000000-0000-4000-8000-000000000002' },
    update: {},
    create: { id: '10000000-0000-4000-8000-000000000002', role: 'INSTRUCTOR', userId: instructorUser.id, schoolId: SCHOOL_ID },
  });

  // --- A third user: a plain Student (roster needs more than just the owner) ---
  const studentPasscode = await bcrypt.hash('123456', BCRYPT_ROUNDS);
  const studentUser = await prisma.user.upsert({
    where: { email: 'jamie.lee@ultm8.local' },
    update: {},
    create: {
      email: 'jamie.lee@ultm8.local',
      phone: '+15550000003',
      firstName: 'Jamie',
      surname: 'Lee',
      passcodeHash: studentPasscode,
      phoneVerifiedAt: new Date(),
      dateOfBirth: new Date('2001-09-03'),
    },
  });
  await prisma.roleGrant.upsert({
    where: { id: '10000000-0000-4000-8000-000000000003' },
    update: {},
    create: { id: '10000000-0000-4000-8000-000000000003', role: 'STUDENT', userId: studentUser.id, schoolId: SCHOOL_ID },
  });

  // --- Branches ---
  const mainBranch = await prisma.branch.upsert({
    where: { id: '20000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '20000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      name: 'Downtown',
      address: '221 Main St, Springfield',
      contactPhone: '+15550001111',
      timezone: 'America/New_York',
    },
  });
  await prisma.branch.upsert({
    where: { id: '20000000-0000-4000-8000-000000000002' },
    update: {},
    create: {
      id: '20000000-0000-4000-8000-000000000002',
      schoolId: SCHOOL_ID,
      name: 'Westside',
      address: '48 Harbor Ave, Springfield',
      timezone: 'America/New_York',
    },
  });

  // --- Instructor profile ---
  await prisma.instructor.upsert({
    where: { id: '30000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '30000000-0000-4000-8000-000000000001',
      userId: instructorUser.id,
      schoolId: SCHOOL_ID,
      branchId: mainBranch.id,
      yearsOfExperience: 9,
      bio: 'Black belt, competes regionally, coaches the adult fundamentals class.',
    },
  });

  // --- Discipline + Ranks ---
  const discipline = await prisma.discipline.upsert({
    where: { id: '40000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '40000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      name: 'Brazilian Jiu-Jitsu',
      classTypesOffered: ['Gi', 'No-Gi'],
    },
  });
  await prisma.rank.upsert({
    where: { id: '41000000-0000-4000-8000-000000000001' },
    update: {},
    create: { id: '41000000-0000-4000-8000-000000000001', disciplineId: discipline.id, schoolId: SCHOOL_ID, name: 'White Belt', order: 0, primaryColour: '#FFFFFF' },
  });
  await prisma.rank.upsert({
    where: { id: '41000000-0000-4000-8000-000000000002' },
    update: {},
    create: { id: '41000000-0000-4000-8000-000000000002', disciplineId: discipline.id, schoolId: SCHOOL_ID, name: 'Blue Belt', order: 1, primaryColour: '#1E3A8A' },
  });

  // --- Classes (one-off, taught by the Instructor) ---
  const now = new Date();
  const inDays = (d, h) => { const dt = new Date(now); dt.setDate(dt.getDate() + d); dt.setHours(h, 0, 0, 0); return dt; };
  const class1 = await prisma.class.upsert({
    where: { id: '50000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '50000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      branchId: mainBranch.id,
      instructorId: instructorUser.id,
      title: 'Adult Fundamentals',
      activities: ['Brazilian Jiu-Jitsu'],
      startDate: inDays(1, 18),
      endDate: inDays(1, 19),
      capacity: 20,
    },
  });
  await prisma.class.upsert({
    where: { id: '50000000-0000-4000-8000-000000000002' },
    update: {},
    create: {
      id: '50000000-0000-4000-8000-000000000002',
      schoolId: SCHOOL_ID,
      branchId: mainBranch.id,
      instructorId: instructorUser.id,
      title: 'Advanced No-Gi',
      activities: ['Brazilian Jiu-Jitsu'],
      startDate: inDays(3, 19),
      endDate: inDays(3, 20),
      capacity: 15,
    },
  });

  // --- Timetable slot (recurring template) ---
  const t = (h) => { const dt = new Date('1970-01-01T00:00:00Z'); dt.setUTCHours(h, 0, 0, 0); return dt; };
  await prisma.timetableSlot.upsert({
    where: { id: '60000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '60000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      branchId: mainBranch.id,
      instructorId: instructorUser.id,
      weekday: 'MONDAY',
      startTime: t(18),
      endTime: t(19),
      title: 'Adult Fundamentals',
      activities: ['Brazilian Jiu-Jitsu'],
      capacity: 20,
    },
  });

  // --- Curriculum: category + lesson ---
  const category = await prisma.lessonCategory.upsert({
    where: { id: '70000000-0000-4000-8000-000000000001' },
    update: {},
    create: { id: '70000000-0000-4000-8000-000000000001', schoolId: SCHOOL_ID, name: 'Escapes', order: 0 },
  });
  await prisma.lesson.upsert({
    where: { id: '71000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '71000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      instructorId: instructorUser.id,
      title: 'Escaping Mount — the Elbow-Knee Escape',
      categoryId: category.id,
      free: true,
      format: 'PRERECORDED',
    },
  });

  // --- PaymentAccount (Cash/Bank — no Stripe needed) ---
  const paymentAccount = await prisma.paymentAccount.upsert({
    where: { schoolId: SCHOOL_ID },
    update: {},
    create: {
      schoolId: SCHOOL_ID,
      provider: 'BANK_TRANSFER',
      accountTitle: 'Dev Test School — Operating Account',
      country: 'US',
      status: 'ACTIVE',
      mode: 'TEST',
    },
  });

  // --- Membership Plans ---
  const monthlyPlan = await prisma.membershipPlan.upsert({
    where: { id: '80000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '80000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      type: 'SUBSCRIPTION',
      title: 'Monthly Unlimited',
      price: 8999,
      currency: 'USD',
      disciplineIds: [discipline.id],
      includesLessons: true,
    },
  });
  const classPackPlan = await prisma.membershipPlan.upsert({
    where: { id: '80000000-0000-4000-8000-000000000002' },
    update: {},
    create: {
      id: '80000000-0000-4000-8000-000000000002',
      schoolId: SCHOOL_ID,
      type: 'CLASS_PACK',
      title: '10-Class Pack',
      price: 15000,
      currency: 'USD',
      classesIncluded: 10,
    },
  });
  await prisma.membershipPlan.upsert({
    where: { id: '80000000-0000-4000-8000-000000000003' },
    update: {},
    create: {
      id: '80000000-0000-4000-8000-000000000003',
      schoolId: SCHOOL_ID,
      type: 'TRIAL_MEMBERSHIP',
      title: '1-Week Free Trial',
      price: 0,
      currency: 'USD',
      // A Trial lasts 1-30 days (Decision 334).
      expiryDurationDays: 7,
    },
  });

  // --- Memberships: dev user on Monthly Unlimited, Jamie on Class Pack ---
  const devMembership = await prisma.membership.upsert({
    where: { id: '90000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '90000000-0000-4000-8000-000000000001',
      studentId: devUser.id,
      membershipPlanId: monthlyPlan.id,
      schoolId: SCHOOL_ID,
      status: 'ACTIVE',
      frequency: 'RECURRING',
      expiryDate: inDays(23, 0),
    },
  });
  await prisma.membership.upsert({
    where: { id: '90000000-0000-4000-8000-000000000002' },
    update: {},
    create: {
      id: '90000000-0000-4000-8000-000000000002',
      studentId: studentUser.id,
      membershipPlanId: classPackPlan.id,
      schoolId: SCHOOL_ID,
      status: 'ACTIVE',
      frequency: 'ONE_TIME',
      classesRemaining: 7,
    },
  });

  // --- Transactions ---
  await prisma.transaction.upsert({
    where: { id: 'a0000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: 'a0000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      studentId: devUser.id,
      paymentAccountId: paymentAccount.id,
      membershipPlanId: monthlyPlan.id,
      membershipId: devMembership.id,
      billingDate: inDays(-7, 9),
      amount: 8999,
      currency: 'USD',
      status: 'SUCCESSFUL',
      paymentMethod: 'BANK_TRANSFER',
    },
  });
  await prisma.transaction.upsert({
    where: { id: 'a0000000-0000-4000-8000-000000000002' },
    update: {},
    create: {
      id: 'a0000000-0000-4000-8000-000000000002',
      schoolId: SCHOOL_ID,
      studentId: studentUser.id,
      paymentAccountId: paymentAccount.id,
      membershipPlanId: classPackPlan.id,
      billingDate: inDays(-2, 14),
      amount: 15000,
      currency: 'USD',
      status: 'PENDING',
      paymentMethod: 'BANK_TRANSFER',
    },
  });
  await prisma.transaction.upsert({
    where: { id: 'a0000000-0000-4000-8000-000000000003' },
    update: {},
    create: {
      id: 'a0000000-0000-4000-8000-000000000003',
      schoolId: SCHOOL_ID,
      studentId: devUser.id,
      paymentAccountId: paymentAccount.id,
      membershipPlanId: monthlyPlan.id,
      billingDate: inDays(-30, 9),
      amount: 8999,
      currency: 'USD',
      status: 'FAILED',
      paymentMethod: 'BANK_TRANSFER',
    },
  });

  // --- Waiver + signature (dev user signed; Jamie's is still unsigned) ---
  const waiver = await prisma.waiver.upsert({
    where: { id: 'b0000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: 'b0000000-0000-4000-8000-000000000001',
      schoolId: SCHOOL_ID,
      title: 'Liability Waiver',
      body: 'I acknowledge the risks of physical training and release Dev Test School from liability for ordinary injury.',
    },
  });
  await prisma.waiverSignature.upsert({
    where: { id: 'b1000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: 'b1000000-0000-4000-8000-000000000001',
      waiverId: waiver.id,
      studentId: devUser.id,
      signedById: devUser.id,
      schoolId: SCHOOL_ID,
      signerFullName: 'Dev Owner',
      signatureText: 'Dev Owner',
      signedDate: inDays(-7, 9),
      status: 'SIGNED',
    },
  });
  await prisma.waiverSignature.upsert({
    where: { id: 'b1000000-0000-4000-8000-000000000002' },
    update: {},
    create: {
      id: 'b1000000-0000-4000-8000-000000000002',
      waiverId: waiver.id,
      studentId: studentUser.id,
      schoolId: SCHOOL_ID,
      status: 'UNSIGNED',
    },
  });

  // --- Booking: dev user books Class 1 against their Membership ---
  await prisma.booking.upsert({
    where: { id: 'c0000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: 'c0000000-0000-4000-8000-000000000001',
      studentId: devUser.id,
      classId: class1.id,
      schoolId: SCHOOL_ID,
      branchId: mainBranch.id,
      status: 'UPCOMING',
      sourceMembershipId: devMembership.id,
    },
  });

  // --- Notifications for the dev user ---
  const notifs = [
    { title: 'Payment received', body: 'Your Monthly Unlimited payment of $89.99 went through. Thanks!', read: true },
    { title: 'Booking confirmed', body: 'You’re booked into Adult Fundamentals, tomorrow at 6:00 PM.', read: true },
    { title: 'Waiver signed', body: 'Your signature on the Liability Waiver was recorded.', read: false },
    { title: 'New lesson available', body: 'Escaping Mount — the Elbow-Knee Escape is now up in Curriculum.', read: false },
  ];
  for (let i = 0; i < notifs.length; i++) {
    await prisma.notification.upsert({
      where: { id: `d0000000-0000-0000-0000-00000000000${i + 1}` },
      update: {},
      create: { id: `d0000000-0000-0000-0000-00000000000${i + 1}`, userId: devUser.id, ...notifs[i] },
    });
  }

  console.log('Seeded: Branches(2), Instructor(coach.alex@ultm8.local), Student(jamie.lee@ultm8.local), Discipline+2 Ranks, Classes(2), TimetableSlot(1), Curriculum(1 category + 1 lesson), MembershipPlans(3), Memberships(2), Transactions(3), Waiver+2 signatures, Booking(1), Notifications(4).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
