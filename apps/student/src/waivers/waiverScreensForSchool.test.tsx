import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import * as waiverQueries from './waiverQueries';
import { WaiversScreen } from './WaiversScreen';
import { ChildWaiversScreen } from '../guardians/ChildWaiversScreen';

jest.mock('../auth/AuthContext', () => ({ useEnrolledSchoolIds: jest.fn() }));
jest.mock('./waiverQueries', () => ({
  useAllEnrolledSchoolWaivers: jest.fn(),
  useEnrolledSchoolNames: jest.fn(),
  useMyWaiverSignatures: jest.fn(),
  useMinorWaivers: jest.fn(),
}));
jest.mock('./WaiverRow', () => {
  const { Text } = require('react-native');
  return { WaiverRow: (p: { waiver: { title: string } }) => <Text>{`waiver ${p.waiver.title}`}</Text> };
});

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const waiversProps = (schoolId: string) =>
  ({ route: { key: 'Waivers', name: 'Waivers', params: { schoolId } } }) as unknown as React.ComponentProps<typeof WaiversScreen>;

/** Decision 442 item 1: "Sign the waiver" opens the waiver screens limited to
 * the School that refused, when it is one of the person's Schools. */
describe('waiver screens opened for one School', () => {
  beforeEach(() => {
    mocked(auth.useEnrolledSchoolIds).mockReturnValue(['school-1', 'school-2']);
    mocked(waiverQueries.useAllEnrolledSchoolWaivers).mockImplementation((...args: unknown[]) => {
      const ids = args[0] as string[];
      const all = [
        { id: 'w1', schoolId: 'school-1', title: 'Alpha waiver' },
        { id: 'w2', schoolId: 'school-2', title: 'Beta waiver' },
      ];
      return { isLoading: false, isError: false, error: null, items: all.filter((w) => ids.includes(w.schoolId)) };
    });
    mocked(waiverQueries.useEnrolledSchoolNames).mockReturnValue(new Map([['school-1', 'Alpha Dojo'], ['school-2', 'Beta Dojo']]));
    mocked(waiverQueries.useMyWaiverSignatures).mockReturnValue({ isLoading: false, data: { items: [] } });
    mocked(waiverQueries.useMinorWaivers).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        items: [
          { id: 'w1', schoolId: 'school-1', schoolName: 'Alpha Dojo', title: 'Alpha waiver', signedDate: null, childMaySign: false },
          { id: 'w2', schoolId: 'school-2', schoolName: 'Beta Dojo', title: 'Beta waiver', signedDate: null, childMaySign: false },
        ],
      },
    });
  });

  it("My waivers shows only that School's, with its name", async () => {
    const screen = await render(<WaiversScreen {...waiversProps('school-2')} />);
    expect(screen.getByText('Beta Dojo')).toBeTruthy();
    expect(screen.getByText('waiver Beta waiver')).toBeTruthy();
    expect(screen.queryByText('waiver Alpha waiver')).toBeNull();
  });

  it('My waivers shows every School when opened without one', async () => {
    const plain = await render(<WaiversScreen />);
    expect(plain.getByText('waiver Alpha waiver')).toBeTruthy();
    expect(plain.getByText('waiver Beta waiver')).toBeTruthy();
  });

  it('My waivers shows every School for a School the member is not at', async () => {
    const elsewhere = await render(<WaiversScreen {...waiversProps('school-9')} />);
    expect(elsewhere.getByText('waiver Alpha waiver')).toBeTruthy();
    expect(elsewhere.getByText('waiver Beta waiver')).toBeTruthy();
  });

  it("a child's waivers show only that School's", async () => {
    const props = { route: { key: 'ChildWaivers', name: 'ChildWaivers', params: { studentId: 'child-1', name: 'Mia', schoolId: 'school-1' } }, navigation: {} };
    const screen = await render(<ChildWaiversScreen {...(props as unknown as React.ComponentProps<typeof ChildWaiversScreen>)} />);
    expect(screen.getByText('waiver Alpha waiver')).toBeTruthy();
    expect(screen.queryByText('waiver Beta waiver')).toBeNull();
  });
});
