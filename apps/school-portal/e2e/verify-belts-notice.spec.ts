import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addPerson, cleanup, db, seedGradingSchool, type GradingSchool } from './fixtures';

/**
 * The notice at login (Decisions 137 item 4, 189), against the real API: an
 * owner, or a coach who may verify, sees the belts students declared that are
 * waiting to be verified, once per login. Staff who may not verify see
 * nothing. The login request itself is answered here with the test's token
 * (the browser-test API has no login database); everything after it is real.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ; Sam Lee at White 1
  await db.studentRank.updateMany({ where: { studentId: s.student.id }, data: { verificationStatus: 'UNVERIFIED' } });
});

test.afterAll(async () => {
  await cleanup();
});

async function logIn(page: Page, token: string) {
  await page.route('**/v1/auth/login', (route) => route.fulfill({ json: { accessToken: token } }));
  await page.goto('/login');
  await page.getByLabel('Email').fill('someone@example.test');
  await page.getByRole('textbox', { name: 'Passcode' }).fill('123456');
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('the owner sees the waiting belts at login, once', async ({ page }) => {
  await logIn(page, s.ownerToken);
  const notice = page.getByRole('dialog', { name: 'Belts waiting to be verified' });
  await expect(notice.getByRole('list', { name: 'Waiting to be verified' }).getByRole('listitem')).toHaveText(['Sam Lee — BJJ']);

  await notice.getByRole('link', { name: 'Sam Lee' }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}$`));
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sam Lee' })).toBeVisible();
  await expect(notice).toBeHidden();
});

test('a coach who may verify sees it; "Later" closes it', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: coach.id, disciplineId: s.disciplineId } });
  await logIn(page, coach.token);
  const notice = page.getByRole('dialog', { name: 'Belts waiting to be verified' });
  await expect(notice.getByText('Sam Lee')).toBeVisible();
  await notice.getByRole('button', { name: 'Later' }).click();
  await expect(notice).toBeHidden();
  await expect(page).toHaveURL(/\/coach$/);
});

test('a coach who may grade but not verify sees no notice', async ({ page }) => {
  const coach = await addPerson('Vic', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: coach.id, disciplineId: s.disciplineId, canVerifyRanks: false } });
  await logIn(page, coach.token);
  await expect(page).toHaveURL(/\/coach$/);
  await page.waitForLoadState('networkidle'); // the list has come back (empty)
  await expect(page.getByRole('dialog', { name: 'Belts waiting to be verified' })).toHaveCount(0);
});
