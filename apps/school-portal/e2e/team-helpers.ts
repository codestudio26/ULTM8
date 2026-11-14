import type { Locator, Page } from '@playwright/test';

/** The Team pages' own drop-downs (DESIGN.md → "Drop-downs"): open the one
 * named `label` inside `scope` and pick the option named `option`. */
export async function pickOption(scope: Page | Locator, label: string, option: string) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await scope.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option, exact: true }).click();
}


/** A searchable picker (Country, Currency, the student pickers; Decision 462):
 * type into the one named `label` inside `scope` and pick the option named
 * `option` from the matches. */
export async function pickSearchOption(scope: Page | Locator, label: string, option: string, typed = option) {
  const box = scope.getByRole('combobox', { name: label, exact: true });
  await box.click();
  await box.fill(typed);
  await scope.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}
