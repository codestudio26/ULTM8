import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as waiverQueries from './waiverQueries';
import { WaiverRow } from './WaiverRow';

type OnOkHandler = (base64Png: string) => void;

// Jest's module-factory hoisting forbids referencing ordinary out-of-scope
// variables, except ones prefixed `mock` (case-insensitive) — same convention
// QrScanner.test.tsx already established for its own native-module mock.
let mockLastOnOK: OnOkHandler | undefined;
const mockClearSignature = jest.fn();
const FAKE_DRAWN_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

// `react-native-signature-canvas` renders a real HTML5 canvas inside a
// WebView — nothing this test environment can exercise. Stand in with a
// pressable "Simulate draw" that fires `onOK` with a fixed fake PNG data URI,
// and expose `clearSignature` on the ref the same way WaiverRow calls it from
// its own "Clear signature" button.
jest.mock('react-native-signature-canvas', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  const SignatureScreen = ReactActual.forwardRef(
    (props: { onOK?: OnOkHandler }, ref: React.Ref<{ clearSignature: () => void; readSignature: () => void }>) => {
      mockLastOnOK = props.onOK;
      ReactActual.useImperativeHandle(ref, () => ({
        clearSignature: mockClearSignature,
        readSignature: jest.fn(),
      }));
      return (
        <Text testID="simulate-draw" onPress={() => props.onOK?.(FAKE_DRAWN_PNG)}>
          Simulate draw
        </Text>
      );
    },
  );
  return { __esModule: true, default: SignatureScreen };
});

jest.mock('./waiverQueries', () => ({ useSignWaiver: jest.fn() }));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const WAIVER = { id: 'waiver-1', schoolId: 'school-1', title: 'Liability Waiver', body: 'I agree to assume all risk…', version: 3 };

const idleSign = () => ({ mutate: jest.fn(), data: undefined, isPending: false, isSuccess: false, isError: false, error: null });

/**
 * Phase 34/37's drawn-signature capture — an OPTIONAL `react-native-signature-
 * canvas` pad alongside the required typed-name/typed-signature-text fields
 * (the confirmed baseline, Decision 74/78). Mirrors this app's own house
 * style (MembershipPlanRow.test.tsx, QrScanner.test.tsx): mock every query
 * module and native dependency entirely, inline fixtures, render + fireEvent
 * (both awaited).
 */
describe('WaiverRow — drawn-signature capture', () => {
  let sign: ReturnType<typeof idleSign>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLastOnOK = undefined;
    sign = idleSign();
    mocked(waiverQueries.useSignWaiver).mockReturnValue(sign);
  });

  it('shows only "Sign" for an unsigned Waiver, not the signing form', async () => {
    const { getByText, queryByText } = await render(<WaiverRow waiver={WAIVER as never} signature={undefined} />);
    expect(getByText('Sign')).toBeTruthy();
    expect(queryByText('Submit signature')).toBeNull();
  });

  it('shows a signed confirmation, not the form, once a Signed signature exists', async () => {
    const SIGNED = { id: 'sig-1', waiverId: 'waiver-1', signedDate: '2026-10-01', status: 'SIGNED' };
    const { getByText, queryByText } = await render(<WaiverRow waiver={WAIVER as never} signature={SIGNED as never} />);
    expect(getByText(/Signed/)).toBeTruthy();
    expect(queryByText('Sign')).toBeNull();
  });

  it('opens the form with typed fields and an optional drawn-signature pad on "Sign"', async () => {
    const { getByText, getByPlaceholderText, getByTestId } = await render(
      <WaiverRow waiver={WAIVER as never} signature={undefined} />,
    );
    await fireEvent.press(getByText('Sign'));

    expect(getByPlaceholderText('Your full legal name')).toBeTruthy();
    expect(getByPlaceholderText('Type your signature')).toBeTruthy();
    expect(getByText('Drawn signature (optional)')).toBeTruthy();
    expect(getByTestId('simulate-draw')).toBeTruthy();
  });

  it('"Submit signature" stays disabled until both typed fields are filled, independent of drawing', async () => {
    const { getByText, getByPlaceholderText } = await render(<WaiverRow waiver={WAIVER as never} signature={undefined} />);
    await fireEvent.press(getByText('Sign'));

    expect(getByText('Submit signature').parent?.props.accessibilityState?.disabled ?? true).toBeTruthy();
    expect(sign.mutate).not.toHaveBeenCalled();

    await fireEvent.changeText(getByPlaceholderText('Your full legal name'), 'Jane Doe');
    await fireEvent.changeText(getByPlaceholderText('Type your signature'), 'Jane Doe');
    await fireEvent.press(getByText('Submit signature'));

    expect(sign.mutate).toHaveBeenCalledWith({
      waiverId: 'waiver-1',
      waiverVersion: 3,
      signerFullName: 'Jane Doe',
      signatureText: 'Jane Doe',
      signatureImage: null,
    });
  });

  it('submitting without ever drawing sends signatureImage: null — drawing stays optional', async () => {
    const { getByText, getByPlaceholderText } = await render(<WaiverRow waiver={WAIVER as never} signature={undefined} />);
    await fireEvent.press(getByText('Sign'));
    await fireEvent.changeText(getByPlaceholderText('Your full legal name'), 'Jane Doe');
    await fireEvent.changeText(getByPlaceholderText('Type your signature'), 'Jane Doe');
    await fireEvent.press(getByText('Submit signature'));

    expect(sign.mutate).toHaveBeenCalledWith(expect.objectContaining({ signatureImage: null }));
  });

  it('capturing a drawn signature shows "Clear signature" and includes it in signatureImage on submit', async () => {
    const { getByText, getByPlaceholderText, getByTestId, queryByText } = await render(
      <WaiverRow waiver={WAIVER as never} signature={undefined} />,
    );
    await fireEvent.press(getByText('Sign'));
    expect(queryByText('Clear signature')).toBeNull();

    await fireEvent.press(getByTestId('simulate-draw'));
    expect(getByText('Clear signature')).toBeTruthy();

    await fireEvent.changeText(getByPlaceholderText('Your full legal name'), 'Jane Doe');
    await fireEvent.changeText(getByPlaceholderText('Type your signature'), 'Jane Doe');
    await fireEvent.press(getByText('Submit signature'));

    expect(sign.mutate).toHaveBeenCalledWith({
      waiverId: 'waiver-1',
      waiverVersion: 3,
      signerFullName: 'Jane Doe',
      signatureText: 'Jane Doe',
      signatureImage: FAKE_DRAWN_PNG,
    });
  });

  it('"Clear signature" clears the captured drawing and calls the pad\'s own clearSignature()', async () => {
    const { getByText, getByTestId, queryByText } = await render(<WaiverRow waiver={WAIVER as never} signature={undefined} />);
    await fireEvent.press(getByText('Sign'));
    await fireEvent.press(getByTestId('simulate-draw'));
    expect(getByText('Clear signature')).toBeTruthy();

    await fireEvent.press(getByText('Clear signature'));

    expect(mockClearSignature).toHaveBeenCalled();
    expect(queryByText('Clear signature')).toBeNull();
  });

  it('shows an inline error, without crashing, when signing fails', async () => {
    mocked(waiverQueries.useSignWaiver).mockReturnValue({
      ...idleSign(),
      isError: true,
      error: { message: 'Conflict' },
    });
    const { getByText } = await render(<WaiverRow waiver={WAIVER as never} signature={undefined} />);
    await fireEvent.press(getByText('Sign'));

    expect(getByText('Could not sign this waiver — please try again.')).toBeTruthy();
  });
});
