import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ADDRESS_TEXT,
  AddressFields,
  AddressLookupProvider,
  AddressTextProvider,
  postalAddressFromRecord,
  preparePostalAddress,
  type AddressAutocompleteProvider,
} from './AddressFields';
import { EMPTY_POSTAL_ADDRESS, type PostalAddress } from './postalAddress';
import { DEFAULT_UI_STRINGS, UiStringsProvider } from './components';

function Harness({ initial, autocomplete }: { initial: PostalAddress; autocomplete?: AddressAutocompleteProvider }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AddressFields idPrefix="t" value={value} onChange={setValue} autocomplete={autocomplete} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

/** Picks a country in the searchable Country picker (Decision 460), as a person does: type, then click the match. */
async function pickCountry(user: UserEvent, name: string, label = 'Country') {
  const box = screen.getByRole('combobox', { name: label });
  await user.click(box);
  await user.type(box, name);
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name }));
}

describe('AddressFields (Decision 276)', () => {
  it("shows the chosen country's own fields and labels", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />);
    expect(screen.getByLabelText('ZIP code')).toBeInTheDocument();
    // A region from a fixed list is the new look's drop-down, never a browser <select>.
    expect(screen.getByRole('combobox', { name: 'State' })).toBeInstanceOf(HTMLButtonElement);

    await pickCountry(user, 'United Kingdom');
    expect(screen.getByLabelText('Postcode')).toBeInTheDocument();
    expect(screen.getByLabelText('County (optional)')).toBeInstanceOf(HTMLInputElement);
    expect(screen.queryByLabelText('ZIP code')).not.toBeInTheDocument();

    await pickCountry(user, 'United Arab Emirates');
    expect(screen.getByRole('combobox', { name: 'Emirate' })).toBeInstanceOf(HTMLButtonElement);
    expect(screen.queryByLabelText('Postcode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Postal code/)).not.toBeInTheDocument();
  });

  it('keeps what was typed when the country changes', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />);
    await user.type(screen.getByLabelText('Address line 1'), '1 Main St');
    await pickCountry(user, 'Canada');
    expect(screen.getByLabelText('Address line 1')).toHaveValue('1 Main St');
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}').country).toBe('CA');
  });

  it('finds a country by its name, its English name or its code, and stores the code (Decision 460)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />);
    const box = screen.getByRole('combobox', { name: 'Country' });
    expect(box).toHaveValue('United States');
    await user.click(box);
    // Every country, "Select a country" first, until something is typed.
    const all = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(all[0]).toHaveTextContent('Select a country');
    expect(all.length).toBeGreaterThan(200);
    await user.type(box, 'zeal');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['New Zealand']);
    await user.clear(box);
    await user.type(box, 'gb');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['United Kingdom']);
    await user.clear(box);
    await user.type(box, 'qqqq');
    expect(within(screen.getByRole('listbox')).getByText('No matches.')).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'brazil');
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Brazil' }));
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}').country).toBe('BR');
    expect(box).toHaveValue('Brazil');
  });

  it('picks a country and a region with the keyboard; Escape closes without a change', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'GB' }} />);
    const box = screen.getByRole('combobox', { name: 'Country' });
    await user.click(box);
    await user.type(box, 'austral');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}').country).toBe('AU');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(box);
    await user.type(box, 'japan');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(box).toHaveValue('Australia');

    const state = screen.getByRole('combobox', { name: 'State' });
    state.focus();
    // Opens on "Select…", then down past the Australian Capital Territory to New South Wales.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}').region).toBe('NSW');
  });

  it('counts a country or region pick as an edit, as a browser <select> did', async () => {
    const user = userEvent.setup();
    const onInput = vi.fn();
    render(
      <div onInput={onInput}>
        <Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />
      </div>,
    );
    const box = screen.getByRole('combobox', { name: 'Country' });
    // Opening and closing, or picking the country already chosen, is not an edit.
    await user.click(box);
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'United States' }));
    expect(onInput).not.toHaveBeenCalled();
    await user.click(box);
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Canada' }));
    expect(onInput).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('combobox', { name: 'Province' }));
    await user.click(screen.getByRole('option', { name: 'Ontario' }));
    expect(onInput).toHaveBeenCalledTimes(2);
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}')).toMatchObject({ country: 'CA', region: 'ON' });
  });

  it('shows a region error under the drop-down and tells screen readers', () => {
    render(
      <AddressFields idPrefix="t" value={{ ...EMPTY_POSTAL_ADDRESS, country: 'US', line1: '1 Main St', city: 'Austin' }} onChange={vi.fn()} errors={{ region: 'required', country: 'invalid' }} />,
    );
    const state = screen.getByRole('combobox', { name: 'State' });
    expect(state).toHaveAttribute('aria-invalid', 'true');
    expect(state).toHaveAccessibleDescription('State is required.');
    const country = screen.getByRole('combobox', { name: 'Country' });
    expect(country).toHaveAttribute('aria-invalid', 'true');
    expect(country).toHaveAccessibleDescription('Choose a country from the list.');
  });

  it('has no search box without a provider', () => {
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'GB' }} />);
    expect(screen.queryByLabelText('Search address')).not.toBeInTheDocument();
  });

  it('fills every field from a search result, replacing what was there', async () => {
    const user = userEvent.setup();
    const provider: AddressAutocompleteProvider = {
      suggest: vi.fn().mockResolvedValue([{ id: 'p1', label: '10 Downing Street', secondary: 'London, UK' }]),
      resolve: vi.fn().mockResolvedValue({ line1: '10 Downing Street', line2: '', city: 'London', region: '', postalCode: 'SW1A 2AA', country: 'GB' }),
    };
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'GB', line2: 'Old flat' }} autocomplete={provider} />);
    await user.type(screen.getByLabelText('Search address'), '10 Down');
    const option = await screen.findByRole('option', { name: /10 Downing Street/ });
    expect(screen.getByText('Powered by Google')).toBeInTheDocument();
    await user.click(option);
    await waitFor(() => expect(screen.getByLabelText('Postcode')).toHaveValue('SW1A 2AA'));
    expect(screen.getByLabelText('Address line 1')).toHaveValue('10 Downing Street');
    expect(screen.getByLabelText(/Address line 2/)).toHaveValue('');
    expect(screen.getByLabelText('Town/City')).toHaveValue('London');
    expect(screen.getByLabelText('Search address')).toHaveValue('');
    expect(provider.suggest).toHaveBeenCalledWith('10 Down', 'GB');
    expect(provider.resolve).toHaveBeenCalledWith('p1');
  });

  it('picks with the keyboard, and takes its provider from AddressLookupProvider', async () => {
    const user = userEvent.setup();
    const provider: AddressAutocompleteProvider = {
      suggest: vi.fn().mockResolvedValue([
        { id: 'a', label: '1 Main St, Springfield' },
        { id: 'b', label: '1 Main St, Shelbyville' },
      ]),
      resolve: vi.fn().mockResolvedValue({ line1: '1 Main St', city: 'Shelbyville', region: 'IL', postalCode: '62565', country: 'US' }),
    };
    render(
      <AddressLookupProvider provider={provider}>
        <Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />
      </AddressLookupProvider>,
    );
    await user.type(screen.getByLabelText('Search address'), '1 Main');
    await screen.findAllByRole('option', { name: /1 Main St/ });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(provider.resolve).toHaveBeenCalledWith('b'));
    await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Shelbyville'));
  });

  it('says when nothing matches or the search fails, and leaves the fields alone', async () => {
    const user = userEvent.setup();
    const provider: AddressAutocompleteProvider = {
      suggest: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('503')),
      resolve: vi.fn(),
    };
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'GB' }} autocomplete={provider} />);
    const box = screen.getByLabelText('Search address');
    await user.type(box, 'zzzz');
    expect(await screen.findByText(ADDRESS_TEXT.searchNoResults)).toBeInTheDocument();
    await user.type(box, 'y');
    expect(await screen.findByText(ADDRESS_TEXT.searchFailed)).toBeInTheDocument();
    expect(screen.getByLabelText('Address line 1')).toHaveValue('');
  });

  it('hides the search box when a null provider is given', () => {
    render(
      <AddressLookupProvider provider={null}>
        <Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'GB' }} />
      </AddressLookupProvider>,
    );
    expect(screen.queryByLabelText('Search address')).not.toBeInTheDocument();
  });
});

describe('postalAddressFromRecord / preparePostalAddress', () => {
  it("puts a pre-Decision-276 one-line address into line 1 and leaves the country to choose", () => {
    expect(postalAddressFromRecord({ address: '1 Old Road, Leeds' }, 'GB')).toEqual({ ...EMPTY_POSTAL_ADDRESS, line1: '1 Old Road, Leeds' });
  });

  it('starts an empty address on the default country', () => {
    expect(postalAddressFromRecord(null, 'MY')).toEqual({ ...EMPTY_POSTAL_ADDRESS, country: 'MY' });
  });

  it('leaves an untouched address out of the request, even a legacy one that would not validate', () => {
    const legacy = postalAddressFromRecord({ address: '1 Old Road, Leeds' });
    expect(preparePostalAddress(legacy, legacy)).toEqual({ ok: true, postalAddress: undefined });
  });

  it('sends null for a cleared address, and errors for an incomplete one', () => {
    const initial = postalAddressFromRecord({ addressCountry: 'GB', addressLine1: '1 High St', addressCity: 'Leeds', addressPostalCode: 'LS1 4AP' });
    expect(preparePostalAddress({ ...EMPTY_POSTAL_ADDRESS, country: 'GB' }, initial)).toEqual({ ok: true, postalAddress: null });
    expect(preparePostalAddress({ ...initial, postalCode: '' }, initial)).toEqual({ ok: false, errors: { postalCode: 'required' } });
  });

  it('takes its text from AddressTextProvider and its country names from the UI locale', () => {
    const text = { ...ADDRESS_TEXT, country: 'País', postal: { ...ADDRESS_TEXT.postal, zip: 'Código ZIP' } };
    render(
      <UiStringsProvider strings={DEFAULT_UI_STRINGS} locale="es">
        <AddressTextProvider text={text}>
          <Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />
        </AddressTextProvider>
      </UiStringsProvider>,
    );
    expect(screen.getByLabelText('Código ZIP')).toBeInTheDocument();
    const country = screen.getByRole('combobox', { name: 'País' });
    expect(country).toHaveValue(new Intl.DisplayNames(['es'], { type: 'region' }).of('US'));
  });
});
