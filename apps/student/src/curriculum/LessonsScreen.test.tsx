import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import * as curriculumQ from './curriculumQueries';
import * as waiverQ from '../waivers/waiverQueries';
import { LessonsScreen } from './LessonsScreen';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('./curriculumQueries', () => ({
  useLessonsOverviewForStudent: jest.fn(),
  useLessonCategoryOrder: jest.fn(),
  useFavorites: jest.fn(),
  useWatchHistory: jest.fn(),
}));
jest.mock('../waivers/waiverQueries', () => ({ useEnrolledSchoolNames: jest.fn() }));

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null }) as never;
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: 'l1',
  schoolId: 'alpha',
  instructorId: null,
  title: 'Escaping Mount',
  category: 'Escapes',
  categoryId: 'cat1',
  order: 0,
  free: true,
  locked: false,
  durationSeconds: 600,
  description: 'The elbow-knee escape.',
  format: 'PRERECORDED',
  videoRef: null,
  captionStatus: 'PENDING',
  captionTrackRef: null,
  skillIds: [],
  archivedAt: null,
  purgeAt: null,
  purgedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: 'me', grants: [] } });
  mocked(waiverQ.useEnrolledSchoolNames).mockReturnValue(new Map([['alpha', 'Alpha Dojo'], ['beta', 'Beta Dojo']]));
  mocked(curriculumQ.useLessonCategoryOrder).mockReturnValue(new Map([['cat1', 0]]));
  mocked(curriculumQ.useFavorites).mockReturnValue({ lessonIds: new Set(), isLoading: false, isError: false, error: null });
  mocked(curriculumQ.useWatchHistory).mockReturnValue({ items: [], isLoading: false, isError: false, error: null });
});

function nav() {
  return { navigate: jest.fn() } as never;
}

describe('LessonsScreen', () => {
  it('fetches the signed-in Student\'s own Lessons when no route params are given', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [lesson()] }));
    const { getByText } = await render(<LessonsScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(mocked(curriculumQ.useLessonsOverviewForStudent)).toHaveBeenCalledWith('me');
    expect(getByText('Escaping Mount')).toBeTruthy();
  });

  it('a guardian opens it for their child — passes the minor\'s id, not their own', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [lesson()] }));
    await render(<LessonsScreen navigation={nav()} route={{ params: { studentId: 'kid', name: 'Kai' } } as never} />);
    expect(mocked(curriculumQ.useLessonsOverviewForStudent)).toHaveBeenCalledWith('kid');
  });

  it('groups by School only when there is more than one, in first-seen order', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(
      ok({ items: [lesson({ id: 'l1', schoolId: 'alpha' }), lesson({ id: 'l2', schoolId: 'beta', title: 'Takedown Defense' })] }),
    );
    const { getByText, queryByText } = await render(<LessonsScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('Alpha Dojo')).toBeTruthy();
    expect(getByText('Beta Dojo')).toBeTruthy();
    expect(getByText('Escaping Mount')).toBeTruthy();
    expect(getByText('Takedown Defense')).toBeTruthy();

    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [lesson({ schoolId: 'alpha' })] }));
    const single = await render(<LessonsScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(single.queryByText('Alpha Dojo')).toBeNull();
  });

  it('says so when there are no lessons yet', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [] }));
    const { getByText } = await render(<LessonsScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('No lessons yet.')).toBeTruthy();
  });

  it('shows a locked Lesson\'s reason instead of its description', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [lesson({ locked: true, description: null })] }));
    const { getByText } = await render(<LessonsScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('Locked — not included in your current membership.')).toBeTruthy();
  });

  it('self view: shows "My Playlists" and fetches favorites/watch-history for the real Schools', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [lesson()] }));
    const { getByText } = await render(<LessonsScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('My Playlists')).toBeTruthy();
    expect(mocked(curriculumQ.useFavorites)).toHaveBeenCalledWith(['alpha']);
    expect(mocked(curriculumQ.useWatchHistory)).toHaveBeenCalledWith(['alpha']);
  });

  it('guardian view: hides "My Playlists" and never fetches the guardian\'s own favorites/watch-history — ' +
    'Favorite/WatchHistory/Playlist have no guardian-delegation path server-side (Decision 254\'s own disclosed gap), ' +
    'so showing them here would silently reflect the guardian, not the linked minor', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [lesson()] }));
    const { queryByText } = await render(
      <LessonsScreen navigation={nav()} route={{ params: { studentId: 'kid', name: 'Kai' } } as never} />,
    );
    expect(queryByText('My Playlists')).toBeNull();
    expect(mocked(curriculumQ.useFavorites)).toHaveBeenCalledWith([]);
    expect(mocked(curriculumQ.useWatchHistory)).toHaveBeenCalledWith([]);
  });

  it('guardian view: opening a Lesson forwards the minor\'s studentId to LessonDetail', async () => {
    mocked(curriculumQ.useLessonsOverviewForStudent).mockReturnValue(ok({ items: [lesson()] }));
    const navigate = jest.fn();
    const { getByText } = await render(
      <LessonsScreen navigation={{ navigate } as never} route={{ params: { studentId: 'kid', name: 'Kai' } } as never} />,
    );
    fireEvent.press(getByText('Escaping Mount'));
    expect(navigate).toHaveBeenCalledWith('LessonDetail', expect.objectContaining({ studentId: 'kid' }));
  });
});
