// Global AsyncStorage mock — found necessary when `components/ui.tsx`'s
// `Button` started reading SchoolThemeContext (Decision 266), which imports
// AuthContext.tsx, which imports '@react-native-async-storage/async-storage'
// directly: `ui.tsx` is imported by dozens of screens' test files that never
// needed this mocked before, since nothing this widely-shared pulled in
// AuthContext's own dependency chain until now. Same mock shape
// auth/AuthContext.test.tsx already used locally (kept for consistency
// rather than switching to the library's own built-in mock helper) —
// centralized here instead of pasted into every now-affected test file
// individually.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

// Global stand-in for the signature pad (a WebView canvas, which has no
// native module under jest): the plan contract signer (Decision 316 item 6)
// sits in MembershipPlanRow, which many screens render. Tests that drive the
// pad (WaiverRow.test.tsx) mock it themselves; that mock wins.
jest.mock('react-native-signature-canvas', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const SignatureScreen = React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => ({ clearSignature: () => undefined, readSignature: () => undefined }));
    return React.createElement(Text, null, 'signature pad');
  });
  return { __esModule: true, default: SignatureScreen };
});

// Global stand-in for Firebase Cloud Messaging (Decision 463): its native
// module doesn't exist under jest, and AuthContext pulls it in through
// pushRegistration.ts, which most screens' tests import. pushRegistration's
// own test sets what these return.
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(async () => 'test-fcm-token'),
  deleteToken: jest.fn(async () => undefined),
  onTokenRefresh: jest.fn(() => () => undefined),
}));
