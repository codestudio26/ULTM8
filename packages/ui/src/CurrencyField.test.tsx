import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CurrencyField } from './components';

// Alphabetical, the way GET /settings/currencies returns them.
const OPTIONS = [
  { code: '', name: 'Not set' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'USD', name: 'US Dollar' },
];

function optionCodes() {
  return within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent?.split(' — ')[0]);
}

describe('CurrencyField', () => {
  it('lists USD, GBP, EUR and BRL first, after "Not set", then the rest alphabetically', async () => {
    const user = userEvent.setup();
    render(<CurrencyField value="" onChange={vi.fn()} options={OPTIONS} />);
    await user.click(screen.getByRole('combobox'));
    expect(optionCodes()).toEqual(['Not set', 'USD', 'GBP', 'EUR', 'BRL', 'AED', 'JPY']);
  });

  it('keeps the same order among search matches', async () => {
    const user = userEvent.setup();
    render(<CurrencyField value="" onChange={vi.fn()} options={OPTIONS} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'r'); // every currency here except JPY, and not "Not set"
    expect(optionCodes()).toEqual(['USD', 'GBP', 'EUR', 'BRL', 'AED']);
  });
});
