import type { Locator, Page } from '@playwright/test';

/** The Team pages' own drop-downs (DESIGN.md → "Drop-downs"): open the one
 * named `label` inside `scope` and pick the option named `option`. */
export async function pickOption(scope: Page | Locator, label: string, option: string) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await scope.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option, exact: true }).click();
}

