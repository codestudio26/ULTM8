import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type Playlist = components['schemas']['PlaylistResponseDto'];
export type PlaylistItem = components['schemas']['PlaylistItemResponseDto'];

/** A separate file from curriculumQueries.ts (per this slice's task description) —
 * Playlist is the Student's own, not School-scoped the way Lesson/Favorite/
 * WatchHistory/Comment all are (every endpoint below lives under plain
 * `/v1/curriculum/playlists...`, never `/v1/schools/{schoolId}/...`), so it's a
 * meaningfully different concern, not an arbitrary split. Mirrors the exact
 * mutation/invalidation style already established in curriculumQueries.ts and
 * waiverQueries.ts (useSignWaiver, useCancelBooking): a plain `useMutation` per
 * action, `onSuccess` invalidates the one query key that action affects, no
 * hand-rolled optimistic updates. */

/** GET /curriculum/playlists — requested at the max page size (100, see
 * PaginationQueryDto) as a single page, same "wide single page" precedent as
 * `useMyWaiverSignatures`/`useFavorites`: a Student realistically never
 * approaches 100 playlists. */
export function useMyPlaylists() {
  return useQuery({
    queryKey: ['my-playlists'],
    queryFn: () => unwrap(apiClient.GET('/v1/curriculum/playlists', { params: { query: { limit: 100 } } })),
  });
}

export function useCreatePlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => unwrap(apiClient.POST('/v1/curriculum/playlists', { body: { name } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-playlists'] }),
  });
}

export function useRenamePlaylist(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        apiClient.PATCH('/v1/curriculum/playlists/{id}', {
          params: { path: { id: playlistId } },
          body: { name },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-playlists'] }),
  });
}

/** Takes the playlist id at `mutate()` time, not hook-creation time — unlike
 * `useRenamePlaylist`/`usePlaylistItems` below, PlaylistsScreen's delete action
 * fires from a list of many playlists, so there's no one fixed id to bind the
 * hook to up front (matches the task's own §5 hook signature, `useDeletePlaylist()`
 * with no id argument). */
export function useDeletePlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (playlistId: string) =>
      unwrap(apiClient.DELETE('/v1/curriculum/playlists/{id}', { params: { path: { id: playlistId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-playlists'] }),
  });
}

/** GET /curriculum/playlists/{id}/items — NOT paginated (flat `items` array,
 * confirmed against schema.d.ts), ordered by each item's own `order` field (not
 * guaranteed by the response itself — PlaylistDetailScreen sorts client-side
 * before rendering, same discipline SchoolLessons already applies to a Lesson's
 * own `order`). */
export function usePlaylistItems(playlistId: string) {
  return useQuery({
    queryKey: ['playlist-items', playlistId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/curriculum/playlists/{id}/items', { params: { path: { id: playlistId } } })),
    enabled: !!playlistId,
  });
}

export function useAddPlaylistItem(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) =>
      unwrap(
        apiClient.POST('/v1/curriculum/playlists/{id}/items', {
          params: { path: { id: playlistId } },
          body: { lessonId },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playlist-items', playlistId] }),
  });
}

/** DELETE .../items/{itemId} — idempotent server-side (a no-op if the item is
 * already gone), 204 on success. */
export function useRemovePlaylistItem(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      unwrap(
        apiClient.DELETE('/v1/curriculum/playlists/{id}/items/{itemId}', {
          params: { path: { id: playlistId, itemId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playlist-items', playlistId] }),
  });
}

/** PUT .../items/order — must include EVERY item currently in the playlist
 * exactly once, or the backend rejects it with 409/400 (per this slice's own
 * task description). PlaylistDetailScreen's `moveItem` builds that full id list
 * itself (adjacent-swap, same "move up/down buttons, not drag-and-drop" pattern
 * apps/school-portal's CurriculumPage.tsx already uses for Lesson/category
 * ordering) — this hook just sends whatever full array it's given. */
export function useReorderPlaylistItems(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) =>
      unwrap(
        apiClient.PUT('/v1/curriculum/playlists/{id}/items/order', {
          params: { path: { id: playlistId } },
          body: { itemIds },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playlist-items', playlistId] }),
  });
}
