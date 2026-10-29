import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { SchoolNotesScreen } from './SchoolNotesScreen';
import { useMemberNotes } from './notesQueries';

jest.mock('./notesQueries', () => ({ useMemberNotes: jest.fn() }));
const mocked = useMemberNotes as jest.Mock;
const screen = (params?: { studentId?: string; name?: string }) =>
  render(<SchoolNotesScreen {...({ route: { params }, navigation: {} } as unknown as React.ComponentProps<typeof SchoolNotesScreen>)} />);

describe('SchoolNotesScreen (Decision 400)', () => {
  it('lists the notes shown to the student, with the School and who wrote them', async () => {
    mocked.mockReturnValue({
      data: { items: [{ id: 'n1', schoolId: 's1', schoolName: 'Lotus BJJ', body: 'Great work at the open mat!', authorName: 'Rafael Lima', createdAt: '2026-10-20T10:00:00.000Z' }] },
      isLoading: false,
      isError: false,
    });
    const { getByText } = await screen();
    expect(getByText('Lotus BJJ')).toBeTruthy();
    expect(getByText('Great work at the open mat!')).toBeTruthy();
    expect(getByText(/^Rafael Lima · /)).toBeTruthy();
    expect(mocked).toHaveBeenCalledWith(undefined);
  });

  it("a Guardian sees their child's notes; with none, it says so", async () => {
    mocked.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
    const { getByText } = await screen({ studentId: 'kid-1', name: 'Mia' });
    expect(getByText('No notes from your School yet.')).toBeTruthy();
    expect(mocked).toHaveBeenCalledWith('kid-1');
  });
});
