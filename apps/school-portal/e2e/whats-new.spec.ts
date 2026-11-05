import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * "What's new" (Decision 318 item 3): posts written by ULTM8 HQ in Platform
 * Admin show to School owners and staff, newest first, in their language
 * (English when a post has no translation in it).
 */
let s: GradingSchool;
const postIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await db.productUpdate.deleteMany({ where: { id: { in: postIds } } });
  await cleanup();
});

test('the owner opens What\'s new from the header and reads the posts', async ({ page }) => {
  const older = await db.productUpdate.create({
    data: { id: randomUUID(), title: `Payroll report ${randomUUID().slice(0, 6)}`, body: 'See what to pay each coach.', createdById: randomUUID(), createdAt: new Date('2026-10-01T12:00:00Z') },
  });
  const newer = await db.productUpdate.create({
    data: {
      id: randomUUID(),
      title: `Automatic grading ${randomUUID().slice(0, 6)}`,
      body: 'Students move up on their own.\nUndo is one click.',
      createdById: randomUUID(),
      translations: { create: { locale: 'pt-BR', title: 'Graduação automática', body: 'Os alunos sobem sozinhos.' } },
    },
  });
  postIds.push(older.id, newer.id);

  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  await page.getByTestId('whats-new-link').click();
  await expect(page).toHaveURL(/\/whats-new$/);
  const posts = page.getByTestId('whats-new-post');
  await expect(posts.filter({ hasText: newer.title })).toBeVisible();
  await expect(posts.filter({ hasText: older.title })).toBeVisible();
  const titles = await posts.locator('h2').allTextContents();
  expect(titles.indexOf(newer.title)).toBeLessThan(titles.indexOf(older.title));
  await expect(posts.filter({ hasText: newer.title })).toContainText('Undo is one click.');
});
