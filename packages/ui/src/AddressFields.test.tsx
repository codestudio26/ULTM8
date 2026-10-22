import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AddressFields,
  postalAddressFromRecord,
  preparePostalAddress,
  type AddressAutocompleteProvider,
} from './AddressFields';
import { EMPTY_POSTAL_ADDRESS, type PostalAddress } from './postalAddress';

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

  it('fills every field from an autocomplete suggestion', async () => {
    const user = userEvent.setup();
    const provider: AddressAutocompleteProvider = {
      suggest: vi.fn().mockResolvedValue([{ id: 'p1', label: '10 Downing Street, London' }]),
      resolve: vi.fn().mockResolvedValue({ line1: '10 Downing Street', city: 'London', postalCode: 'SW1A 2AA', country: 'GB' }),
    };
    render(<Harness initial={{ ...EMPTY_POSTAL_ADDRESS, country: 'GB' }} autocomplete={provider} />);
    await user.type(screen.getByLabelText('Address line 1'), '10 Down');
    const option = await screen.findByRole('option', { name: '10 Downing Street, London' });
    await user.click(option);
    await waitFor(() => expect(screen.getByLabelText('Postcode')).toHaveValue('SW1A 2AA'));
    expect(screen.getByLabelText('Town/City')).toHaveValue('London');
    expect(provider.suggest).toHaveBeenCalledWith('10 Down', 'GB');
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
});
