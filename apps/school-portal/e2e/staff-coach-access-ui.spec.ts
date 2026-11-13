import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Links and requests Branch Staff and coaches can't use (the Branch Staff and
 * coach page check, 13 Nov 2026). Behaviour only, nothing about the look:
 * - A student's page asks for promotion fees only when the caller may see
 *   them: the owner, or someone with grading permission in a style (Decision
 *   314 item 1, the API's 403 otherwise). Those who may still see the fees.
 * - "Open full page" on Students: the student's page opens for everyone the
 *   list shows the student to (the API reads it by the Grading Board's branch
 *   rule, Decision 168, the same rule as the list, Decision 341), with or
 *   without grading permission.
 * - "Front-desk mode" on Check-in only for those who can start it: the owner,
 *   or Branch Staff for their own Branch.
 */
let s: GradingSchool;
type Person = Awaited<ReturnType<typeof addPerson>>;
let staff: Person;
let coach: Person;
let gradingCoach: Person;
let schoolWideCoach: Person;

test.beforeAll(async () => {
  s = await seedGradingSchool();
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  await db.school.update({ where: { id: s.schoolId }, data: { promotionFeeEnabled: true, defaultCurrency: 'GBP' } });
  await db.promotionFeeRequest.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      studentId: s.student.id,
      disciplineId: s.disciplineId,
      toRungId: s.rung['White 2'].id,
      toRungName: 'White 2',
      expectedCurrentRungId: s.rung['White 1'].id,
      amountMinor: 4000,
      currency: 'GBP',
      status: 'PENDING',
      promotionWaits: false,
    },
  });
  // Branch Staff and a coach at North with no grading permission, a coach at
  // North with it, and a coach for the whole School (no Branch).
  staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  gradingCoach = await addPerson('Pia', 'Grader', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  schoolWideCoach = await addPerson('Wes', 'Wide', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: gradingCoach.id, disciplineId: s.disciplineId } });
});

test.afterAll(async () => {
  await db.promotionFeeRequest.deleteMany({ where: { schoolId: s.schoolId } });
  await cleanup();
});

/** Every promotion-fee-requests response the page gets, by status. */
function feeResponses(page: Page) {
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/promotion-fee-requests')) statuses.push(r.status());
  });
  return statuses;
}

async function openStudentPage(page: Page, token: string) {
  await signIn(page, token);
  await page.goto(`/students/${s.student.id}?tab=ranks`);
  await expect(page.locator('.u8n-page-header h1')).toHaveText('Sam Lee');
  await page.waitForLoadState('networkidle');
}

const feeList = (page: Page) => page.getByRole('region', { name: 'Promotion fees', exact: true });

test.describe("a student's page asks for promotion fees only from those who may see them", () => {
  for (const [who, person] of [
    ['Branch Staff without grading permission', () => staff],
    ['a coach without grading permission', () => coach],
  ] as const) {
    test(`${who}: no request, so no 403`, async ({ page }) => {
      const statuses = feeResponses(page);
      await openStudentPage(page, person().token);
      expect(statuses).toEqual([]);
    });
  }

  test('the owner still sees the fees', async ({ page }) => {
    const statuses = feeResponses(page);
    await openStudentPage(page, s.ownerToken);
    await expect(feeList(page)).toContainText('White 2');
    expect(statuses).toContain(200);
    expect(statuses.filter((code) => code >= 400)).toEqual([]);
  });

  test('a coach with grading permission still sees the fees', async ({ page }) => {
    const statuses = feeResponses(page);
    await openStudentPage(page, gradingCoach.token);
    await expect(feeList(page)).toContainText('White 2');
    expect(statuses).toContain(200);
    expect(statuses.filter((code) => code >= 400)).toEqual([]);
  });
});

test.describe('"Open full page" on Students opens the page for everyone the list shows the student to', () => {
  for (const [who, token] of [
    ['the owner', () => s.ownerToken],
    ['Branch Staff without grading permission', () => staff.token],
    ['a coach without grading permission', () => coach.token],
    ['a coach with grading permission', () => gradingCoach.token],
  ] as const) {
    test(`${who}: the link opens the page, with no error`, async ({ page }) => {
      const failed: string[] = [];
      page.on('response', (r) => {
        // The student's grading, which the page needs to open at all.
        if (r.status() === 403 && /\/(eligibility|rank-history)\b/.test(r.url())) failed.push(r.url());
      });
      await signIn(page, token());
      await page.goto('/students');
      await page.getByRole('link', { name: 'Open full page: Sam Lee' }).click();
      await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}$`));
      await expect(page.locator('.u8n-page-header h1')).toHaveText('Sam Lee');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText("You may not view this Student's grading.")).toHaveCount(0);
      expect(failed).toEqual([]);
    });
  }

  test('a coach for the whole School, at a School with Branches, is shown no student and so no link', async ({ page }) => {
    await signIn(page, schoolWideCoach.token);
    await page.goto('/students');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: /^Open full page/ })).toHaveCount(0);
  });
});

test.describe('"Front-desk mode" on Check-in only for those who can start it', () => {
  for (const [who, token, shown] of [
    ['the owner', () => s.ownerToken, true],
    ['Branch Staff', () => staff.token, true],
    ['a coach', () => coach.token, false],
    ['a coach with grading permission', () => gradingCoach.token, false],
  ] as const) {
    test(`${who}: ${shown ? 'shown' : 'not shown'}`, async ({ page }) => {
      await signIn(page, token());
      await page.goto('/check-in');
      await expect(page.locator('.u8n-page-header h1')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const link = page.getByRole('link', { name: 'Front-desk mode' });
      if (shown) {
        await expect(link).toBeVisible();
        await link.click();
        await expect(page).toHaveURL(/\/front-desk$/);
        await expect(page.getByRole('radio', { name: 'North' })).toBeVisible();
      } else {
        await expect(link).toHaveCount(0);
      }
    });
  }
});

test.describe('the student page\'s "‹" link goes back where the person came from', () => {
  const back = (page: Page) => page.locator('.u8n-page-header__parent');

  for (const [who, token] of [
    ['the owner', () => s.ownerToken],
    ['Branch Staff', () => staff.token],
    ['a coach', () => coach.token],
  ] as const) {
    test(`${who}, from Students: "‹ Students"`, async ({ page }) => {
      await signIn(page, token());
      await page.goto('/students');
      await page.getByRole('link', { name: 'Open full page: Sam Lee' }).click();
      await expect(page.locator('.u8n-page-header h1')).toHaveText('Sam Lee');
      await expect(back(page)).toHaveText('‹ Students');
      await back(page).click();
      await expect(page).toHaveURL(/\/students$/);
    });
  }

  for (const [who, token] of [
    ['the owner', () => s.ownerToken],
    ['a coach with grading permission', () => gradingCoach.token],
  ] as const) {
    test(`${who}, from the Grading Board: "‹ Grading Board", on both tabs`, async ({ page }) => {
      await signIn(page, token());
      await page.goto('/grading');
      await page.locator('.u8gb-card__name').getByRole('link', { name: 'Sam Lee' }).first().click();
      await expect(page.locator('.u8n-page-header h1')).toHaveText('Sam Lee');
      await expect(back(page)).toHaveText('‹ Grading Board');
      // Switching tab keeps it.
      await page.locator('.u8n-tabs--page').getByRole('link', { name: 'Profile' }).click();
      await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}$`));
      await expect(back(page)).toHaveText('‹ Grading Board');
      await back(page).click();
      await expect(page).toHaveURL(/\/grading$/);
    });
  }

  for (const [who, token] of [
    ['the owner', () => s.ownerToken],
    ['a coach with grading permission', () => gradingCoach.token],
  ] as const) {
    test(`${who}, by a typed URL: "‹ Students"`, async ({ page }) => {
      await signIn(page, token());
      await page.goto(`/students/${s.student.id}?tab=ranks`);
      await expect(page.locator('.u8n-page-header h1')).toHaveText('Sam Lee');
      await expect(back(page)).toHaveText('‹ Students');
    });
  }
});
