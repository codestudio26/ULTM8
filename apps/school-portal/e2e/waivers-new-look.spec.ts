import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Waivers page in the new look (Decision 453): the waivers list beside
 * the reader (the Split-Pane Reader), the selected waiver's Signatures and
 * Guest signatures in the right-hand panel, and nothing shown twice: the
 * title, the Archived tag and the reading time are on the row, so the reader
 * leaves them out. On a phone, tapping a waiver shrinks the list to it and
 * Export sits under ⋯ More.
 */
let s: GradingSchool;
const waiverIds: string[] = [];

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.waiverSignature.deleteMany({ where: { waiverId: { in: waiverIds } } });
  await db.waiver.deleteMany({ where: { id: { in: waiverIds } } });
  waiverIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

async function addWaiver(title: string, body: string, archived = false) {
  const w = await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title, body, archivedAt: archived ? new Date() : null } });
  waiverIds.push(w.id);
  return w;
}

test('the reader shows the selected waiver without repeating its row; Signatures sit in the right-hand panel', async ({ page }) => {
  const w = await addWaiver('Reader Waiver', 'Training has risks. You train at your own risk.');
  await db.waiverSignature.create({
    data: { id: randomUUID(), waiverId: w.id, studentId: s.student.id, signedById: s.student.id, schoolId: s.schoolId, signerFullName: 'Sam Lee', signatureText: 'Sam Lee', status: 'SIGNED', signedDate: new Date() },
  });

  await page.goto('/waivers');
  await expect(page.getByRole('heading', { level: 1, name: 'Waivers' })).toBeVisible();
  for (const name of ['Export signed documents', 'Settings', 'Add waiver']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();

  const row = page.getByRole('button', { name: /Reader Waiver/ });
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(row.getByText('9 words · ~1 min read')).toBeVisible();

  const reader = page.getByRole('region', { name: 'Reader Waiver' });
  await expect(reader.getByText('Training has risks. You train at your own risk.')).toBeVisible();
  await expect(reader.getByText(/^Last updated /)).toBeVisible();
  await expect(reader.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(reader.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  // Not repeated from the row.
  await expect(reader.getByText('Reader Waiver')).toHaveCount(0);
  await expect(reader.getByText(/min read/)).toHaveCount(0);

  const panel = page.locator('.u8n-inspector');
  await expect(panel.getByRole('heading', { level: 3, name: 'Signatures', exact: true })).toBeVisible();
  await expect(panel.getByText('1 of 1 signed')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Sam Lee/ })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Guest signatures' })).toBeVisible();
  await expect(panel.getByText('Reader Waiver')).toHaveCount(0);

  // Edit and Archive share the row equally (DESIGN.md → "Button pairs").
  const edit = await reader.getByRole('button', { name: 'Edit', exact: true }).boundingBox();
  const archive = await reader.getByRole('button', { name: 'Archive', exact: true }).boundingBox();
  expect(Math.round(edit!.width)).toBe(Math.round(archive!.width));
  expect(Math.round(edit!.height)).toBe(Math.round(archive!.height));
});

test('"Remind everyone" sits under the list in the panel', async ({ page }) => {
  const w = await addWaiver('Remind Look Waiver', 'text');
  await db.waiverSignature.create({ data: { id: randomUUID(), waiverId: w.id, studentId: s.newStudent.id, schoolId: s.schoolId, status: 'UNSIGNED' } });

  await page.goto('/waivers');
  const panel = page.locator('.u8n-inspector');
  const entry = await panel.getByRole('button', { name: new RegExp(`^${s.newStudent.name}`) }).boundingBox();
  const remind = await panel.getByRole('button', { name: "Remind everyone who hasn't signed" }).boundingBox();
  expect(remind!.y).toBeGreaterThan(entry!.y + entry!.height);
});

test('"Show archived" is a chip; an archived waiver is tagged on its row and can be unarchived', async ({ page }) => {
  await addWaiver('Current Waiver', 'text');
  const old = await addWaiver('Retired Waiver', 'old text', true);

  await page.goto('/waivers');
  await expect(page.getByRole('button', { name: /Retired Waiver/ })).toHaveCount(0);
  const chip = page.getByRole('button', { name: 'Show archived (1)' });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const row = page.getByRole('button', { name: /Retired Waiver/ });
  await expect(row.getByText('Archived', { exact: true })).toBeVisible();
  await row.click();
  const reader = page.getByRole('region', { name: 'Retired Waiver' });
  await expect(reader.getByText('Archived', { exact: true })).toHaveCount(0);
  await reader.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(row.getByText('Archived', { exact: true })).toHaveCount(0);
  expect((await db.waiver.findUniqueOrThrow({ where: { id: old.id } })).archivedAt).toBeNull();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tapping a waiver shrinks the list to it, and Export is under ⋯ More', async ({ page }) => {
    await addWaiver('First Phone Waiver', 'first text');
    await addWaiver('Second Phone Waiver', 'second text');

    await page.goto('/waivers');
    await expect(page.getByRole('button', { name: 'Export signed documents' })).toBeHidden();
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('button', { name: 'Export signed documents' })).toBeVisible();
    await page.getByRole('button', { name: 'More actions' }).click();

    await page.getByRole('button', { name: /First Phone Waiver/ }).click();
    await expect(page.getByRole('button', { name: /Second Phone Waiver/ })).toBeHidden();
    await expect(page.getByRole('region', { name: 'First Phone Waiver' }).getByText('first text')).toBeVisible();
    await page.getByRole('button', { name: 'Show all waivers (2)' }).click();
    await expect(page.getByRole('button', { name: /Second Phone Waiver/ })).toBeVisible();

    // The panel moves below the page, and nothing scrolls sideways.
    const reader = await page.getByRole('region', { name: 'First Phone Waiver' }).boundingBox();
    const signatures = await page.getByRole('heading', { level: 3, name: 'Signatures', exact: true }).boundingBox();
    expect(signatures!.y).toBeGreaterThan(reader!.y + reader!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
