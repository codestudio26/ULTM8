import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { RegisterScreen } from './RegisterScreen';

// No `RegisterScreen.test.tsx` existed before this (checked first) — mirrors
// attendanceQueries.test.tsx's own `jest.mock('../api', ...)` pattern for a
// screen that calls `apiClient` directly via `unwrap`, rather than through a
// react-query hook.
jest.mock('../api', () => ({
  apiClient: { POST: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiClient } = require('../api') as { apiClient: { POST: ReturnType<typeof jest.fn> } };

function okResponse<T>(data: T) {
  return Promise.resolve({ data, response: { ok: true, status: 200 } as Response });
}

function nav() {
  return { navigate: jest.fn() } as never;
}

describe('RegisterScreen', () => {
  afterEach(() => {
    apiClient.POST.mockReset();
  });

  it('composes the phone number typed into PhoneField into a plain E.164 string on submit', async () => {
    apiClient.POST.mockReturnValueOnce(okResponse({}));
    const navigation = nav();
    const screen = await render(<RegisterScreen navigation={navigation} route={{} as never} />);

    // The other fields (email/name/passcode/DOB) aren't this test's concern —
    // this screen has no client-side "required" gate on them (RN `TextInput` has
    // no native `required`, unlike the web `RegisterPage`'s `<input required>`),
    // so submitting with just the phone filled in still reaches `apiClient.POST`,
    // which is all that's needed to verify PhoneField's own output.
    const phoneInput = screen.getByLabelText('Phone number');
    await fireEvent.press(screen.getByLabelText('Country calling code'));
    await fireEvent.changeText(screen.getByLabelText('Search country'), 'united states');
    await fireEvent.press(screen.getByText('United States'));
    await fireEvent.changeText(phoneInput, '4155552671');

    await fireEvent.press(screen.getByText('Create account'));

    expect(apiClient.POST).toHaveBeenCalledWith(
      '/v1/auth/register',
      expect.objectContaining({ body: expect.objectContaining({ phone: '+14155552671' }) }),
    );
    expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('VerifyOtp', { phone: '+14155552671' });
  });
});
