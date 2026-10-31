import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('AddressFields (Decision 276)', () => {
  it("shows the chosen country's own fields and labels", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />);
    expect(screen.getByLabelText('ZIP code')).toBeInTheDocument();
    expect(screen.getByLabelText('State')).toBeInstanceOf(HTMLSelectElement);

    await user.selectOptions(screen.getByLabelText('Country'), 'GB');
    expect(screen.getByLabelText('Postcode')).toBeInTheDocument();
    expect(screen.getByLabelText('County (optional)')).toBeInstanceOf(HTMLInputElement);
    expect(screen.queryByLabelText('ZIP code')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Country'), 'AE');
    expect(screen.getByLabelText('Emirate')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.queryByLabelText('Postcode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Postal code/)).not.toBeInTheDocument();
  });

  it('keeps what was typed when the country changes', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'US' }} />);
    await user.type(screen.getByLabelText('Address line 1'), '1 Main St');
    await user.selectOptions(screen.getByLabelText('Country'), 'CA');
    expect(screen.getByLabelText('Address line 1')).toHaveValue('1 Main St');
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
    const country = screen.getByLabelText('País') as HTMLSelectElement;
    expect(country.selectedOptions[0]?.textContent).toBe(new Intl.DisplayNames(['es'], { type: 'region' }).of('US'));
  });
});
