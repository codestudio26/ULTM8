import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { PhoneField } from './ui';

// `components/ui.tsx` has no existing `.test.tsx` (checked before writing this —
// no file in this app's src/components/ui/ directory structure either, since
// that's a single file, not a directory). Named after the source file, same
// co-location convention every other test in this app already follows (e.g.
// MembershipPlanRow.tsx / MembershipPlanRow.test.tsx) — scoped to `PhoneField`
// specifically, the one component in this file that's non-trivial enough to
// warrant its own tests today.
describe('PhoneField', () => {
  it('composes a national number against the currently selected country into E.164', async () => {
    const onChange = jest.fn();
    const screen = await render(<PhoneField value="" onChange={onChange} defaultCountry="US" />);

    // Defaults to the given country — no picker interaction needed to see +1.
    expect(screen.getByText(/\+1$/)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Phone number'), '4155551234');
    expect(onChange).toHaveBeenLastCalledWith('+14155551234');
  });

  it('picking a different country changes the dial code shown and recomposes the number', async () => {
    const onChange = jest.fn();
    const screen = await render(<PhoneField value="" onChange={onChange} defaultCountry="US" />);

    await fireEvent.changeText(screen.getByLabelText('Phone number'), '2012345678');
    expect(onChange).toHaveBeenLastCalledWith('+12012345678');

    await fireEvent.press(screen.getByLabelText('Country calling code'));
    await fireEvent.changeText(screen.getByLabelText('Search country'), 'united kingdom');
    await fireEvent.press(screen.getByText('United Kingdom'));

    expect(screen.getByText(/\+44$/)).toBeTruthy();
    // Same digits the user already typed, now composed against the new country.
    expect(onChange).toHaveBeenLastCalledWith('+442012345678');
  });

  it('an incomplete/invalid number is flagged inline once the field is blurred, without being cleared', async () => {
    const onChange = jest.fn();
    const screen = await render(<PhoneField value="" onChange={onChange} defaultCountry="US" />);

    const input = screen.getByLabelText('Phone number');
    // Too short to be a possible US number, and doesn't start with "1" (which
    // libphonenumber-js's AsYouType would otherwise read as the NANP trunk code
    // the user already typed, same as dialing convention) — a clean "incomplete
    // national number" case.
    await fireEvent.changeText(input, '415555');
    expect(screen.queryByText(/Enter a valid phone number/)).toBeNull(); // not flagged until touched

    await fireEvent(input, 'blur');
    expect(screen.getByText('Enter a valid phone number for United States.')).toBeTruthy();
    // Still reflects what was typed — an invalid number is flagged, not discarded.
    expect(onChange).toHaveBeenLastCalledWith('+1415555');
  });

  it('resyncs from an externally-prefilled E.164 value (e.g. carried over via a route param)', async () => {
    const screen = await render(<PhoneField value="+442012345678" onChange={jest.fn()} />);
    expect(screen.getByText(/\+44$/)).toBeTruthy();
    // The displayed national number is derived from the resynced digits — any
    // formatter-inserted spacing aside, the digits themselves must round-trip.
    const shown = screen.getByLabelText('Phone number').props.value as string;
    expect(shown.replace(/\s/g, '')).toBe('2012345678');
  });
});
