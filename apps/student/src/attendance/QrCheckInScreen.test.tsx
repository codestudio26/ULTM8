import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import { QrCheckInScreen } from './QrCheckInScreen';
import { useMyQrToken, type QrTokenResponse } from './attendanceQueries';

jest.mock('./attendanceQueries', () => ({
  useMyQrToken: jest.fn(),
}));

const mockUseMyQrToken = useMyQrToken as jest.Mock<typeof useMyQrToken>;

// The screen only reads these 5 fields off the real UseQueryResult — a full fake
// would just be copying react-query's own internal type back at itself.
function fakeResult(fields: {
  data: QrTokenResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isRefetching: boolean;
}): ReturnType<typeof useMyQrToken> {
  return fields as unknown as ReturnType<typeof useMyQrToken>;
}

describe('QrCheckInScreen', () => {
  beforeEach(() => {
    mockUseMyQrToken.mockReset();
  });

  it('shows a spinner while the first token is loading', async () => {
    mockUseMyQrToken.mockReturnValue(fakeResult({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      isRefetching: false,
    }));

    const { getByTestId } = await render(<QrCheckInScreen />);

    expect(getByTestId('activity-indicator')).toBeTruthy();
  });

  it('renders the QR code for the current token once loaded', async () => {
    mockUseMyQrToken.mockReturnValue(fakeResult({
      data: { token: 'student-abc123', expiresAt: new Date().toISOString() },
      isLoading: false,
      isError: false,
      error: null,
      isRefetching: false,
    }));

    const { getByText } = await render(<QrCheckInScreen />);

    expect(getByText(/show this to your instructor to check in/i)).toBeTruthy();
  });

  it('shows a full-screen error only when there is no cached token to fall back on', async () => {
    mockUseMyQrToken.mockReturnValue(fakeResult({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL', 'boom'),
      isRefetching: false,
    }));

    const { getByText } = await render(<QrCheckInScreen />);

    expect(getByText('boom')).toBeTruthy();
  });

  it('keeps showing the last good token through a background refetch failure', async () => {
    mockUseMyQrToken.mockReturnValue(fakeResult({
      data: { token: 'still-good', expiresAt: new Date().toISOString() },
      isLoading: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL', 'boom'),
      isRefetching: true,
    }));

    const { queryByText, getByText } = await render(<QrCheckInScreen />);

    expect(queryByText('boom')).toBeNull();
    expect(getByText(/show this to your instructor to check in/i)).toBeTruthy();
  });
});
