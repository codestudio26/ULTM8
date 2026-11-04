import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import * as academyQueries from '../academies/academyQueries';
import { ClassTicketOffer } from './ClassTicketOffer';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('../academies/academyQueries', () => ({ useAcademy: jest.fn() }));
jest.mock('../memberships/MembershipPlanRow', () => {
  const { Text } = require('react-native');
  return {
    MembershipPlanRow: (p: { plan: { title: string }; forStudentId?: string }) => <Text>{`${p.plan.title} for ${p.forStudentId ?? 'me'}`}</Text>,
  };
});

const reactQuery = jest.requireMock('@tanstack/react-query') as { useQuery: jest.Mock };
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const PLANS = [
  { id: 'p-ticket', title: 'Seminar ticket' },
  { id: 'p-general', title: 'General pack' },
];

/** Decision 428 (Student portal review M4). */
describe('ClassTicketOffer', () => {
  it("shows only the class's own ticket from the School's plans, bought for the child when a parent asks", async () => {
    reactQuery.useQuery.mockReturnValue({ isLoading: false, data: { planIds: ['p-ticket'] } });
    mocked(academyQueries.useAcademy).mockReturnValue({ isLoading: false, data: { membershipPlans: PLANS } });
    const screen = await render(<ClassTicketOffer classId="c1" schoolId="s1" studentId="kid-1" />);
    expect(screen.getByText("Buy this class's ticket, then tap Book again.")).toBeTruthy();
    expect(screen.getByText('Seminar ticket for kid-1')).toBeTruthy();
    expect(screen.queryByText(/General pack/)).toBeNull();
  });

  it('says to ask the School when no ticket is on sale', async () => {
    reactQuery.useQuery.mockReturnValue({ isLoading: false, data: { planIds: [] } });
    mocked(academyQueries.useAcademy).mockReturnValue({ isLoading: false, data: { membershipPlans: PLANS } });
    const screen = await render(<ClassTicketOffer classId="c1" schoolId="s1" />);
    expect(screen.getByText('No ticket for this class is on sale in the app. Ask the School.')).toBeTruthy();
  });
});
