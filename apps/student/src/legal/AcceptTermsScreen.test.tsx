import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AcceptTermsScreen } from './AcceptTermsScreen';

jest.mock('../api', () => ({ apiClient: { POST: jest.fn() } }));
jest.mock('../notifications/pushRegistration', () => ({ registerForPushNotificationsAsync: jest.fn() }));
const mockApplyAccessToken = jest.fn(async (_token: string) => undefined);
const mockLogout = jest.fn(async () => undefined);
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ applyAccessToken: mockApplyAccessToken, logout: mockLogout }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiClient } = require('../api') as { apiClient: { POST: ReturnType<typeof jest.fn> } };

const TERMS = 'I agree to the Terms of Service and I have read the Privacy Policy.';

describe('AcceptTermsScreen (Decision 448 item 8)', () => {
  afterEach(() => {
    apiClient.POST.mockReset();
    mockApplyAccessToken.mockClear();
    mockLogout.mockClear();
  });

  it('asks for the tick before sending anything, and links to both pages', async () => {
    const screen = await render(<AcceptTermsScreen />);
    expect(screen.getByText('Before you continue')).toBeTruthy();
    expect(screen.getByText('Terms of Service')).toBeTruthy();
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continue'));
    expect(apiClient.POST).not.toHaveBeenCalled();
    expect(screen.getByText('Agree to the Terms of Service and the Privacy Policy to continue.')).toBeTruthy();
  });

  it('records the tick and swaps in the new token', async () => {
    apiClient.POST.mockReturnValueOnce(Promise.resolve({ data: { accessToken: 'fresh.token' }, response: { ok: true, status: 201 } as Response }));
    const screen = await render(<AcceptTermsScreen />);
    await fireEvent(screen.getByLabelText(TERMS), 'valueChange', true);
    await fireEvent.press(screen.getByText('Continue'));
    expect(apiClient.POST).toHaveBeenCalledWith('/v1/auth/legal-acceptance', { body: { acceptTerms: true } });
    await waitFor(() => expect(mockApplyAccessToken).toHaveBeenCalledWith('fresh.token'));
  });

  it('"Log out" signs out', async () => {
    const screen = await render(<AcceptTermsScreen />);
    await fireEvent.press(screen.getByText('Log out'));
    expect(mockLogout).toHaveBeenCalled();
  });
});
