import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The new look for Branch Staff and coaches (Decisions 453, 460: "everything
 * should look like the new design and nothing from the old should be kept").
 * Every page each of them can open, on a phone (390px): the new page header,
 * nothing of the old page header, no old card or tag outside a page that
 * restyles it, no browser <select>, and nothing that scrolls the page
 * sideways. Branch Staff are checked with no extra permissions and with every
 * one the owner can give; coaches plain, with their permissions, and at two
 * Schools. Then the look fixes of this sweep: the Timetable's rows on a tablet
 * beside the menu, the front-desk tablet in dark mode and its sign-up form,
 * and the owner Dashboard's Attendance figures. Look only: what each role may
 * do is covered by the pages' own specs.
 */
let s: GradingSchool;
let s2: GradingSchool;
let classId: string;
const HOUR = 3_600_000;
type Person = Awaited<ReturnType<typeof addPerson>>;
const people: Record<string, Person> = {};

/** Old-look pieces a page may still use, but only inside a page scope that restyles them. */
const RESTYLED_IN = '.u8o, .u8c, .u8gb, .u8sp, .u8t-card__body';

test.beforeAll(async () => {
  s = await seedGradingSchool();
  s2 = await seedGradingSchool();
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  await db.school.update({ where: { id: s.schoolId }, data: { branchStaffCanRecordPayments: true } });
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
  const membership = await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, schoolId: s.schoolId, membershipPlanId: plan.id, frequency: 'RECURRING' } });

  people.staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  people.staffAll = await addPerson('Max', 'Front', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  people.coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  people.coachAll = await addPerson('Pia', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  people.coachTwo = await addPerson('Tess', 'Twin', [
    { role: 'INSTRUCTOR', schoolId: s.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  await db.staffPermission.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, userId: people.staffAll.id,
      canManageDisciplines: true, canManageClasses: true, canManageBookings: true, canManageStudents: true, canCancelClasses: true,
      canSeeStaffList: true, canStartOpenMat: true, canManageCheckInRules: true, canExportStudents: true, canManageMemberFiles: true,
      canCreateCharges: true, canCancelCharges: true, canFreezeMemberships: true, canSeeAttendanceStats: true, canSeeMedicalInfo: true,
      canImportData: true, canSeePayroll: true, canConnectStripe: true,
    },
  });
  await db.staffPermission.create({
    data: { id: randomUUID(), schoolId: s.schoolId, userId: people.coachAll.id, canManageStudentsAsCoach: true, canCreateCharges: true, canStartOpenMat: true },
  });
  for (const id of [people.staffAll.id, people.coachAll.id]) {
    await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: id, disciplineId: s.disciplineId } });
  }

  const cls = await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, branchId: north.id, instructorId: people.coach.id, title: 'Evening BJJ', activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }], startDate: new Date(Date.now() - 10 * 60_000), endDate: new Date(Date.now() + HOUR),
    },
  });
  classId = cls.id;
  // A class that ends after midnight, tonight (the School's clock is UTC), so
  // it is always in this week's Timetable.
  const lateStart = new Date();
  lateStart.setUTCHours(23, 30, 0, 0);
  await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, branchId: north.id, title: 'Late open mat', activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }], startDate: lateStart, endDate: new Date(lateStart.getTime() + HOUR),
    },
  });
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, branchId: north.id, sourceMembershipId: membership.id } });
  await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, branchId: north.id, title: 'North tomorrow', activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }], startDate: new Date(Date.now() + 24 * HOUR), endDate: new Date(Date.now() + 25 * HOUR),
    },
  });
});

test.afterAll(async () => {
  for (const school of [s, s2]) {
    const where = { schoolId: school.schoolId };
    await db.booking.deleteMany({ where });
    await db.membership.deleteMany({ where });
    await db.membershipPlan.deleteMany({ where });
    await db.class.deleteMany({ where });
  }
  await cleanup();
});

/** Every page each role reaches from its menu, the page tabs and the pages'
 * own links (`:student` is Sam Lee's page, `:class` today's class). */
const PAGES: Record<string, string[]> = {
  // Branch Staff with no extra permissions (the defaults).
  staff: [
    '/coach', '/students', '/students/sign-ups', '/students/attendance', '/students/:student', '/students/:student/edit', '/check-in',
    '/classes', '/classes/:class', '/classes/:class/roll-call', '/classes/:class/qr-code', '/timetable', '/curriculum', '/cancellations',
    '/grading', '/disciplines', '/grading/skills', '/grading/settings', '/transactions', '/billing-reports', '/notifications',
  ],
  // Branch Staff with every permission the owner can give, grading included.
  staffAll: [
    '/coach', '/students', '/students/sign-ups', '/students/attendance', '/students/growth', '/students/import', '/students/:student',
    '/students/:student/edit', '/check-in', '/check-in/rules', '/staff', '/classes', '/classes/:class', '/classes/:class/roll-call',
    '/classes/:class/qr-code', '/timetable', '/curriculum', '/cancellations', '/grading', '/disciplines', '/grading/skills',
    '/grading/settings', '/transactions', '/billing-reports', '/payroll', '/school', '/notifications',
  ],
  // A coach with no permissions. (A student's page needs grading permission.)
  coach: [
    '/coach', '/students', '/students/attendance', '/check-in', '/classes', '/classes/:class', '/classes/:class/roll-call',
    '/classes/:class/qr-code', '/curriculum', '/grading', '/disciplines', '/grading/skills', '/grading/settings', '/my-belts',
    '/complete-instructor-profile', '/notifications',
  ],
  // A coach with grading, "Manage students", charges and open mat.
  coachAll: [
    '/coach', '/students', '/students/attendance', '/students/:student', '/students/:student/edit', '/check-in', '/classes',
    '/classes/:class', '/classes/:class/roll-call', '/curriculum', '/grading', '/disciplines', '/grading/skills', '/grading/settings',
    '/my-belts', '/complete-instructor-profile', '/notifications',
  ],
  coachTwo: ['/coach', '/students', '/classes', '/curriculum', '/grading', '/disciplines', '/my-belts', '/complete-instructor-profile', '/notifications'],
};

async function expectNewLookPage(page: Page, path: string) {
  await expect(page.locator('.u8n-page-header h1').first(), `${path}: the new page header`).toBeVisible();
  await page.waitForLoadState('networkidle');
  const main = page.locator('.u8n-content');
  await expect(main.locator('.ultm8-page-header')).toHaveCount(0);
  await expect(page.locator('select')).toHaveCount(0);
  const unstyled = await main.evaluate(
    (el, scopes) => [...el.querySelectorAll('.ultm8-card, .ultm8-badge')].filter((e) => !e.closest(scopes)).map((e) => e.className),
    RESTYLED_IN,
  );
  expect(unstyled).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test.describe('every page on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const [role, paths] of Object.entries(PAGES)) {
    for (const template of paths) {
      test(`${role} ${template}: the new look, no old pieces and no sideways scroll`, async ({ page }) => {
        const path = template.replace(':student', s.student.id).replace(':class', classId);
        await signIn(page, people[role].token);
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${path.replace(/[/]/g, '\\/')}$`));
        await expectNewLookPage(page, path);
      });
    }
  }
});

test('the coach at two Schools: the School switcher is the new drop-down and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, people.coachTwo.token);
  await page.goto('/coach');
  await expect(page.getByRole('combobox', { name: 'Switch School' })).toHaveClass(/u8n-select__field/);
  await expectNewLookPage(page, '/coach');
});

test("the Timetable's class rows fit their card on a tablet beside the menu (900px)", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1100 });
  await signIn(page, people.staff.token);
  await page.goto('/timetable');
  const row = page.locator('.u8s-entry').filter({ hasText: 'Evening BJJ' });
  await expect(row).toBeVisible();
  const [rowBox, menuBox] = [await row.boundingBox(), await row.locator('.u8s-entry__actions').boundingBox()];
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
  // The style tag keeps its room, never hidden under the ⋮.
  const tagBox = (await row.locator('.u8s-entry__tags').getByText('BJJ').boundingBox())!;
  expect(tagBox.width).toBeGreaterThan(0);
  expect(tagBox.x + tagBox.width).toBeLessThanOrEqual(menuBox!.x);
  // A class past midnight: its longer time ("… (next day)") wraps in its own
  // column, never running into the seats beside it.
  const late = page.locator('.u8s-entry').filter({ hasText: 'Late open mat' });
  await expect(late.locator('.u8s-entry__time')).toContainText('next day');
  const ink = (selector: string) =>
    late.locator(selector).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
  expect((await ink('.u8s-entry__time')).right).toBeLessThanOrEqual((await ink('.u8s-entry__seats')).left);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

/** The relative luminance of an element's own background (0 black … 1 white). */
async function backgroundLuminance(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.map(Number);
    const [r, g, b] = m.slice(0, 3).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    // A see-through colour sits on the dark page: weigh it by its alpha.
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) * (m.length > 3 ? m[3] : 1);
  });
}

test.describe('the front-desk tablet in dark mode', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

  test('Start front-desk mode, the tablet and its sign-up: dark surfaces, readable text, no browser <select>', async ({ page }) => {
    const desk = await addPerson('Kia', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: (await db.branch.findFirstOrThrow({ where: { schoolId: s.schoolId, name: 'North' } })).id }]);
    await signIn(page, desk.token);
    await page.goto('/front-desk');
    await expect(page.getByTestId('fd-my-code')).toBeVisible();
    // The branch choice and the "Your code" note were near-white with light text.
    expect(await backgroundLuminance(page, '.fd-kiosk .fd-tick')).toBeLessThan(0.2);
    expect(await backgroundLuminance(page, '[data-testid="fd-my-code"]')).toBeLessThan(0.2);

    await page.getByRole('radio', { name: 'North' }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page).toHaveURL(/\/front-desk\/kiosk$/);
    expect(await backgroundLuminance(page, '.fd-kiosk__side')).toBeLessThan(0.2);
    expect(await backgroundLuminance(page, '.fd-scan')).toBeLessThan(0.2);
    // The pale mint "Sign up" pill keeps dark text.
    const signUp = page.getByRole('button', { name: /Sign up/ }).first();
    await expect(signUp).toHaveCSS('color', 'rgb(32, 38, 44)');

    await signUp.click();
    await expect(page.locator('.fd-steps span.on')).toHaveCSS('color', 'rgb(32, 38, 44)');
    expect(await backgroundLuminance(page, '.fd-steps span:not(.on)')).toBeLessThan(0.2);
    // Gender: three short choices, so pills, as on Register and Edit a student.
    const gender = page.getByRole('group', { name: 'Gender' });
    await expect(gender.getByRole('button')).toHaveText(['Not set', 'Female', 'Male']);
    await gender.getByRole('button', { name: 'Female' }).click();
    await expect(gender.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('First name *').fill('Tess');
    await page.getByLabel('Last name *').fill('Tablet');
    await page.getByLabel('Date of birth *').fill('1994-06-15');
    await page.getByRole('button', { name: 'Next' }).click();
    // "How did you hear about us?" is the new look's own drop-down.
    await pickOption(page, 'How did you hear about us?', 'Friend');
    await expect(page.getByRole('combobox', { name: 'How did you hear about us?' })).toContainText('Friend');
    await expect(page.locator('select')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("the owner Dashboard's Attendance figures", () => {
  let bigClassId: string;
  test.beforeAll(async () => {
    const big = await db.class.create({
      data: {
        id: randomUUID(), schoolId: s.schoolId, title: 'Busy week', activities: ['BJJ'], styles: [{ disciplineId: s.disciplineId, classType: null }],
        startDate: new Date(Date.now() - 2 * HOUR), endDate: new Date(Date.now() - HOUR),
      },
    });
    bigClassId = big.id;
    const row = (status: 'COMPLETED' | 'NO_SHOW') => ({ id: randomUUID(), studentId: s.newStudent.id, classId: big.id, schoolId: s.schoolId, status, sourceMembershipId: null });
    await db.booking.createMany({ data: [...Array.from({ length: 5560 }, () => row('COMPLETED')), ...Array.from({ length: 1500 }, () => row('NO_SHOW'))] });
  });
  test.afterAll(async () => {
    await db.booking.deleteMany({ where: { classId: bigClassId } });
  });

  for (const width of [1440, 900, 390]) {
    test(`present and absent stay apart, never reading as one number (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, s.ownerToken);
      await page.goto('/dashboard');
      const present = page.getByTestId('attendance-present');
      const absent = page.getByTestId('attendance-absent');
      await expect(present).toHaveText('5560');
      await expect(absent).toHaveText('1500');
      // Where each number's digits really are (they can spill out of their box).
      const digits = (testId: string) =>
        page.getByTestId(testId).evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const r = range.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
      const card = (await page.getByTestId('stat-attendance').boundingBox())!;
      const [p, a] = [await digits('attendance-present'), await digits('attendance-absent')];
      // Side by side with a clear gap, or the second under the first.
      const apart = a.x >= p.x + p.width + 16 || a.y >= p.y + p.height;
      expect(apart).toBe(true);
      // Both inside their card.
      for (const box of [p, a]) expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    });
  }
});
