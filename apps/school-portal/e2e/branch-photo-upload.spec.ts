import { expect, test } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Real photo uploads (product-owner-approved — see
 * apps/api/src/uploads/uploads.module.ts's own header comment and
 * CHANGELOG.md "Unreleased"). Picked as the one Playwright coverage point
 * across the 6 new `PhotoUploadField` call sites because it's the simplest to
 * automate: `BranchSettingsPage.tsx` already has a real `GET /branches/{id}`
 * to pre-fill from (unlike the two create-only modals, which need no extra
 * network round-trip before the field is interactive), and its Logo field has
 * a stable, label-derived `id` (`branch-settings-logo`) to target directly.
 *
 * **R2 stubbing, disclosed:** this suite's own `playwright.config.ts` starts
 * the REAL `apps/api` server (`node ../api/dist/main.js`), which needs
 * R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/
 * R2_PUBLIC_BUCKET_NAME/R2_PUBLIC_BASE_URL set in the shell that invokes
 * `npx playwright test` (Playwright's own `webServer.env` merges with, not
 * replaces, `process.env` — same convention apps/api's own e2e suite already
 * relies on for DATABASE_URL/JWT_ACCESS_SECRET, see fixtures.ts's own
 * `signToken`) for `POST /uploads/public-photo-url` to succeed at all
 * (`R2ClientService.assertConfigured()` throws otherwise). Fake-but-valid-
 * shaped values are safe for that step — generating the presigned URL never
 * makes a real network call (same reasoning ci.yml's own comment gives for
 * the pre-existing private-path tests). What a fake value CANNOT do is
 * satisfy the actual browser-side `fetch(uploadUrl, { method: 'PUT', ... })`
 * `PhotoUploadField` makes next — there is no real R2 bucket at a fake host to
 * receive it — so THAT one request is stubbed at the browser level via
 * `page.route()`, the exact same mechanism `verify-belts-notice.spec.ts`
 * already established for stubbing `POST /v1/auth/login` (this codebase's own
 * precedent for "stub one HTTP call the browser makes, let every other real
 * request through"). No Stripe-style SDK-level stub exists anywhere in this
 * codebase to mirror instead — checked before writing this.
 */
let s: GradingSchool;
let branchId: string;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  const branch = await addBranch(s, 'Photo Upload Branch');
  branchId = branch.id;
  await signIn(page, s.ownerToken);
  // Stub the PUT this test never wants to actually reach R2 for — see this
  // file's own header comment. Any OTHER request (the real GET/PATCH
  // /branches/{id}, the real POST /uploads/public-photo-url) passes through
  // untouched.
  await page.route('**/public-photos/**', (route) =>
    route.fulfill({ status: 200, body: '' }),
  );
});

test.afterEach(async () => {
  await db.branch.deleteMany({ where: { id: branchId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('picking a logo file uploads it via the real presign endpoint and saves the resulting public URL', async ({ page }) => {
  await page.goto(`/branches/${branchId}`);
  await expect(page.getByLabel('Branch name')).toHaveValue('Photo Upload Branch');

  // No photo yet — the picker shows "Upload photo", not "Change photo".
  const logoField = page.locator('#branch-settings-logo');
  await expect(page.getByRole('button', { name: 'Upload photo' }).first()).toBeVisible();

  await logoField.setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    // A minimal, syntactically valid 1x1 PNG — PhotoUploadField never decodes
    // or renders this as a real image beyond a local blob: URL preview, so
    // byte-for-byte validity doesn't matter for anything this test checks.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });

  // Upload-in-progress, then success — the button's own label flips to
  // "Change photo" only once onChange has actually fired with a real
  // publicUrl (see PhotoUploadField's own component logic), so waiting on
  // this text IS waiting on the whole presign -> PUT -> onChange sequence to
  // have completed, not a fixed sleep.
  await expect(page.getByRole('button', { name: 'Change photo' }).first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Branch settings saved.')).toBeVisible();

  const updated = await db.branch.findUniqueOrThrow({ where: { id: branchId } });
  expect(updated.logoUrl).toMatch(new RegExp(`/public-photos/branch/${s.schoolId}/${branchId}/.+\\.png$`));

  // Survives a reload — the real, saved publicUrl becomes the next preview's
  // `src`, not the ephemeral local blob: URL the picker showed mid-upload.
  await page.reload();
  const savedLogoUrl = updated.logoUrl!;
  await expect(page.getByRole('img', { name: 'Current photo' }).first()).toHaveAttribute('src', savedLogoUrl);
});
