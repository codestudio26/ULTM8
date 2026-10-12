import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TimezoneField } from './components';

/** `Asia/Tokyo` — a fixed +09:00 zone with no DST — so the offset assertions below
 * are stable regardless of what date CI runs on (the format is asserted, per the
 * task's own flakiness note; only this zone's hour/minute are fixed enough to also
 * assert the exact value safely). */
const TOKYO = 'Asia/Tokyo';

describe('TimezoneField', () => {
  it('renders the given value with its live UTC offset', () => {
    render(<TimezoneField value={TOKYO} onChange={vi.fn()} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue(`${TOKYO} (UTC+09:00)`);
  });

  it('shows no dropdown until the field is interacted with', () => {
    render(<TimezoneField value={TOKYO} onChange={vi.fn()} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('typing filters the option list to matching zones only', async () => {
    const user = userEvent.setup();
    render(<TimezoneField value="" onChange={vi.fn()} />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.type(input, 'tokyo');

    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Asia/Tokyo');
    expect(screen.queryByText(/America\/New_York/)).not.toBeInTheDocument();
  });

  it('matches on a space-normalized reading of the zone name too', async () => {
    const user = userEvent.setup();
    render(<TimezoneField value="" onChange={vi.fn()} />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.type(input, 'new york');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /America\/New_York/ })).toBeInTheDocument();
  });

  it('selecting an option calls onChange with the plain IANA string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimezoneField value="" onChange={onChange} />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.type(input, 'tokyo');
    await user.click(screen.getByRole('option', { name: /Asia\/Tokyo/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(TOKYO);
  });

  it('displays the offset in the UTC±HH:MM format for every rendered option', async () => {
    const user = userEvent.setup();
    render(<TimezoneField value="" onChange={vi.fn()} />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.type(input, 'america/los_angeles');

    const option = screen.getByRole('option', { name: /America\/Los_Angeles/ });
    expect(option.textContent).toMatch(/UTC[+-]\d{2}:\d{2}/);
  });

  it('closes the dropdown and reverts the display to the committed value on Escape', async () => {
    const user = userEvent.setup();
    render(<TimezoneField value={TOKYO} onChange={vi.fn()} />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.type(input, 'lon');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue(`${TOKYO} (UTC+09:00)`);
  });
});
