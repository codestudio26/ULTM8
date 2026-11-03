import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Export all signed documents (Decision 315 item 13) with the owner's
 * "Include member files" tick box (Decision 422 item 9), against the real
 * API: the box is off by default, and ticking it asks for member files. The
 * ZIP itself is made by the API's job and checked in apps/api's
 * signed-documents-export e2e spec; here only the dialog's request is.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.signedDocumentExport.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

async function openDialog(page: import('@playwright/test').Page) {
  await page.goto('/waivers');
  await page.getByRole('button', { name: 'Export signed documents' }).click();
  return page.getByRole('dialog');
}

test('the owner sees "Include member files", off by default; without the tick no member files are asked for', async ({ page }) => {
  const dialog = await openDialog(page);
  const box = dialog.getByRole('checkbox', { name: 'Include member files' });
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await expect(dialog.getByText('in a member-files folder')).toBeVisible();
  // Each signature is a PDF in the ZIP (Decision 422 item 10).
  await expect(dialog.getByText('a PDF for each signature')).toBeVisible();

  const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/v1/schools/${s.schoolId}/signed-documents/exports`));
  await dialog.getByRole('button', { name: 'Make the ZIP' }).click();
  expect(await (await sent).json()).toMatchObject({ includeMemberFiles: false });
  await expect.poll(() => db.signedDocumentExport.count({ where: { schoolId: s.schoolId, includeMemberFiles: false } })).toBe(1);
});

test('ticking it asks the export to include member files', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Include member files' }).check();

  const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/v1/schools/${s.schoolId}/signed-documents/exports`));
  await dialog.getByRole('button', { name: 'Make the ZIP' }).click();
  expect(await (await sent).json()).toMatchObject({ includeMemberFiles: true });
  await expect.poll(() => db.signedDocumentExport.count({ where: { schoolId: s.schoolId, includeMemberFiles: true } })).toBe(1);
  // The dialog then shows how the export is going.
  await expect(dialog.getByTestId('export-status')).toBeVisible();
});
