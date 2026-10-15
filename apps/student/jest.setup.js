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
