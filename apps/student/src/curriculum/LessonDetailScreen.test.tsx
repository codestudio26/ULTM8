import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import * as curriculumQ from './curriculumQueries';
import * as playlistQ from './playlistQueries';
import { LessonDetailScreen } from './LessonDetailScreen';

jest.mock('./LessonVideoPlayer', () => ({ LessonVideoPlayer: () => null }));
jest.mock('./curriculumQueries', () => ({
  useFavorites: jest.fn(),
  useFavoriteLesson: jest.fn(),
  useUnfavoriteLesson: jest.fn(),
  useUpsertWatchProgress: jest.fn(),
  useComments: jest.fn(),
  useCreateComment: jest.fn(),
  useDeleteComment: jest.fn(),
}));
jest.mock('./playlistQueries', () => ({
  useMyPlaylists: jest.fn(),
  useCreatePlaylist: jest.fn(),
  useAddPlaylistItem: jest.fn(),
}));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const idleMutation = () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null }) as never;
const nav = () => ({ navigate: jest.fn() }) as never;

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
  playbackUrl: null,
  archivedAt: null,
  purgeAt: null,
  purgedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked(curriculumQ.useFavorites).mockReturnValue({ lessonIds: new Set(), isLoading: false, isError: false, error: null });
  mocked(curriculumQ.useFavoriteLesson).mockReturnValue(idleMutation());
  mocked(curriculumQ.useUnfavoriteLesson).mockReturnValue(idleMutation());
  mocked(curriculumQ.useUpsertWatchProgress).mockReturnValue(idleMutation());
  mocked(curriculumQ.useComments).mockReturnValue({ data: { items: [] }, isLoading: false, isError: false, error: null } as never);
  mocked(curriculumQ.useCreateComment).mockReturnValue(idleMutation());
  mocked(curriculumQ.useDeleteComment).mockReturnValue(idleMutation());
  mocked(playlistQ.useMyPlaylists).mockReturnValue({ data: { items: [] }, isLoading: false, isError: false, error: null } as never);
  mocked(playlistQ.useCreatePlaylist).mockReturnValue(idleMutation());
});

describe('LessonDetailScreen', () => {
  it('self view: shows the Favorite toggle, Add to Playlist, and the comment thread', async () => {
    const { getByText } = await render(
      <LessonDetailScreen navigation={nav()} route={{ params: { lessonId: 'l1', lesson: lesson() } } as never} />,
    );
    expect(getByText('☆ Favorite')).toBeTruthy();
    expect(getByText('Add to Playlist')).toBeTruthy();
    expect(getByText('No comments yet.')).toBeTruthy();
    expect(mocked(curriculumQ.useFavorites)).toHaveBeenCalledWith(['alpha']);
    expect(mocked(curriculumQ.useComments)).toHaveBeenCalledWith('alpha', 'l1');
  });

  it(
    'guardian view (route.params.studentId set): hides Favorite/Add-to-Playlist/Comments entirely — ' +
      'none of them have a guardian-delegation path server-side (Decision 254\'s own disclosed gap), ' +
      'so they would otherwise run under the guardian\'s own identity and 403 on any non-free Lesson',
    async () => {
      const { getByText, queryByText } = await render(
        <LessonDetailScreen navigation={nav()} route={{ params: { lessonId: 'l1', lesson: lesson({ free: false }), studentId: 'kid' } } as never} />,
      );
      expect(queryByText('☆ Favorite')).toBeNull();
      expect(queryByText('Add to Playlist')).toBeNull();
      expect(queryByText('No comments yet.')).toBeNull();
      expect(getByText("Favorites, Playlists, and Comments aren't available yet while viewing on behalf of a linked Student.")).toBeTruthy();
      // Disabled via an empty lessonId (useComments' own `enabled: !!lessonId` guard), not fetched at all.
      expect(mocked(curriculumQ.useComments)).toHaveBeenCalledWith('alpha', '');
      // Never fetches the guardian's own favorites for this School.
      expect(mocked(curriculumQ.useFavorites)).toHaveBeenCalledWith([]);
    },
  );

  it('guardian view: still shows the video area for an unlocked Lesson (no server round-trip gates it)', async () => {
    const { queryByText } = await render(
      <LessonDetailScreen navigation={nav()} route={{ params: { lessonId: 'l1', lesson: lesson({ free: false, locked: false }), studentId: 'kid' } } as never} />,
    );
    expect(queryByText('Locked — not included in your current membership.')).toBeNull();
  });
});
