import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CurrencyField, TimezoneField } from './components';
import { NewLookSelect } from './NewLookSelect';
import { typeAheadMatch } from './typeAhead';

/** Decision 462 items 6 and 7: Enter in a searchable picker, and type-ahead in a drop-down. */

const CURRENCIES = [
  { code: '', name: 'Not set' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'EUR', name: 'Euro' },
  { code: 'JPY', name: 'Japanese Yen' },
];

describe('typeAheadMatch', () => {
  const labels = ['Select…', 'Mark', 'Maya', 'Noor', 'mia'];
  it('finds the next option starting with a letter, ignoring case, and wraps', () => {
    expect(typeAheadMatch(labels, 'm', 0)).toBe(1);
    expect(typeAheadMatch(labels, 'm', 1)).toBe(2);
    expect(typeAheadMatch(labels, 'mm', 2)).toBe(4);
    expect(typeAheadMatch(labels, 'm', 4)).toBe(1);
  });
  it('matches several letters typed together against the start of a name', () => {
    expect(typeAheadMatch(labels, 'may', 1)).toBe(2);
    expect(typeAheadMatch(labels, 'mar', 1)).toBe(1);
    expect(typeAheadMatch(labels, 'zz', 0)).toBe(-1);
  });
});

describe('Enter in a searchable picker', () => {
  function inForm(field: React.ReactElement) {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={submit}>
        {field}
        <button type="submit">Save</button>
      </form>,
    );
    return submit;
  }

  it('picks the first match for what was typed and never submits the form', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const submit = inForm(<CurrencyField value="" onChange={onChange} options={CURRENCIES} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'eu{Enter}');
    expect(onChange).toHaveBeenCalledWith('EUR');
    expect(screen.queryByRole('listbox')).toBeNull();
    // Closed, Enter still doesn't submit.
    await user.keyboard('{Enter}');
    expect(submit).not.toHaveBeenCalled();
  });

  it('with nothing typed, Enter closes the list and keeps the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const submit = inForm(<CurrencyField value="JPY" onChange={onChange} options={CURRENCIES} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it('with no match, Enter picks nothing and does not submit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const submit = inForm(<CurrencyField value="" onChange={onChange} options={CURRENCIES} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'qqq{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('the time zone picker too', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const submit = inForm(<TimezoneField value="" onChange={onChange} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'new york{Enter}');
    expect(onChange).toHaveBeenCalledWith('America/New_York');
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('NewLookSelect type-ahead', () => {
  const OPTIONS = [
    { value: '', label: 'Select…' },
    { value: 'a', label: 'Mark' },
    { value: 'b', label: 'Noor' },
    { value: 'c', label: 'Maya' },
  ];

  it('a typed letter opens the list on the first option starting with it; again cycles; Enter picks', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NewLookSelect id="who" label="Who" value="" options={OPTIONS} onChange={onChange} />);
    screen.getByRole('combobox').focus();
    await user.keyboard('m');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe('who-option-1');
    await user.keyboard('m');
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe('who-option-3');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('Space with nothing typed still opens the list', async () => {
    const user = userEvent.setup();
    render(<NewLookSelect id="who" label="Who" value="" options={OPTIONS} onChange={vi.fn()} />);
    screen.getByRole('combobox').focus();
    await user.keyboard(' ');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });
});
