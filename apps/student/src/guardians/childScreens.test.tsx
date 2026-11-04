import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as waiverQueries from '../waivers/waiverQueries';
import * as bookingQueries from '../bookings/bookingQueries';
import * as academyQueries from '../academies/academyQueries';
import { ChildWaiversScreen } from './ChildWaiversScreen';
import { ChildPlansScreen } from './ChildPlansScreen';

jest.mock('../waivers/waiverQueries', () => ({ useMinorWaivers: jest.fn() }));
jest.mock('../bookings/bookingQueries', () => ({ useMinorSchools: jest.fn() }));
jest.mock('../academies/academyQueries', () => ({ useAcademy: jest.fn() }));
jest.mock('../waivers/WaiverRow', () => {
  const { Text } = require('react-native');
  return {
    WaiverRow: (p: { waiver: { title: string }; signature?: { signedDate: string }; forStudentId?: string }) => (
      <Text>{`${p.waiver.title} | ${p.signature ? 'signed' : 'unsigned'} | for ${p.forStudentId}`}</Text>
    ),
  };
});
jest.mock('../memberships/MembershipPlanRow', () => {
  const { Text } = require('react-native');
  return { MembershipPlanRow: (p: { plan: { title: string }; schoolId: string; forStudentId?: string }) => <Text>{`${p.plan.title} @ ${p.schoolId} for ${p.forStudentId}`}</Text> };
});

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const props = (studentId = 'kid-1', name = 'Mia'): any => ({ route: { params: { studentId, name } }, navigation: {} });

/** Decision 428 (Student portal review M1, M2). */
describe("ChildWaiversScreen — a parent signs their child's waivers", () => {
  it("groups the child's waivers by School and signs as the child", async () => {
    mocked(waiverQueries.useMinorWaivers).mockReturnValue({
      isLoading: false,
      data: {
        items: [
          { id: 'w1', schoolId: 's1', schoolName: 'Kids Dojo', title: 'Liability', signedDate: '2026-11-01T10:00:00.000Z' },
          { id: 'w2', schoolId: 's1', schoolName: 'Kids Dojo', title: 'Photo consent', signedDate: null },
          { id: 'w3', schoolId: 's2', schoolName: 'Swim Club', title: 'Pool rules', signedDate: null },
        ],
      },
    });
    const screen = await render(<ChildWaiversScreen {...props()} />);
    expect(screen.getByText('Kids Dojo')).toBeTruthy();
    expect(screen.getByText('Swim Club')).toBeTruthy();
    expect(screen.getByText('Liability | signed | for kid-1')).toBeTruthy();
    expect(screen.getByText('Photo consent | unsigned | for kid-1')).toBeTruthy();
  });

  it('says when there is nothing to sign', async () => {
    mocked(waiverQueries.useMinorWaivers).mockReturnValue({ isLoading: false, data: { items: [] } });
    const screen = await render(<ChildWaiversScreen {...props()} />);
    expect(screen.getByText('Mia has no waivers to sign.')).toBeTruthy();
  });
});

describe('ChildPlansScreen — a parent buys a plan for their child', () => {
  beforeEach(() => {
    mocked(academyQueries.useAcademy).mockImplementation((schoolId: unknown) => ({
      isLoading: false,
      data: { membershipPlans: [{ id: `plan-${schoolId}`, title: `Pack at ${schoolId}` }] },
    }));
  });

  it("lists the first School's plans for the child, and switches School", async () => {
    mocked(bookingQueries.useMinorSchools).mockReturnValue({
      isLoading: false,
      data: { items: [{ schoolId: 's1', name: 'Kids Dojo' }, { schoolId: 's2', name: 'Swim Club' }] },
    });
    const screen = await render(<ChildPlansScreen {...props()} />);
    expect(screen.getByText('Pack at s1 @ s1 for kid-1')).toBeTruthy();
    await fireEvent.press(screen.getByText('Swim Club'));
    expect(screen.getByText('Pack at s2 @ s2 for kid-1')).toBeTruthy();
  });

  it("says when the child isn't at any School", async () => {
    mocked(bookingQueries.useMinorSchools).mockReturnValue({ isLoading: false, data: { items: [] } });
    const screen = await render(<ChildPlansScreen {...props()} />);
    expect(screen.getByText("Mia isn't a student at any School yet.")).toBeTruthy();
  });
});
