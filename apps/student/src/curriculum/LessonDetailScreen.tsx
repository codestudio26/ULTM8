import React, { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateTime } from '../lib/formatDate';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { Chip, formatDuration } from './LessonRow';
import { LessonVideoPlayer } from './LessonVideoPlayer';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useFavoriteLesson,
  useFavorites,
  useUnfavoriteLesson,
  useUpsertWatchProgress,
  type Comment,
} from './curriculumQueries';
import { useAddPlaylistItem, useCreatePlaylist, useMyPlaylists, type Playlist } from './playlistQueries';

type Props = NativeStackScreenProps<AppStackParamList, 'LessonDetail'>;

const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>
);

/** One row in the "Add to Playlist" picker. Takes its own fixed `playlistId` —
 * this is a genuinely different component instance per playlist (one per row in
 * the `.map()` below), so calling `useAddPlaylistItem(playlistId)` here, with a
 * stable id for THIS instance's whole lifetime, is exactly how the Rules of
 * Hooks expect a per-id hook to be used; it's not the same hook instance being
 * re-invoked with a changing id. */
function PlaylistOption({ playlist, lessonId }: { playlist: Playlist; lessonId: string }) {
  const addItem = useAddPlaylistItem(playlist.id);
  const [added, setAdded] = useState(false);
  return (
    <View style={{ paddingVertical: spacing[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: theme.textPrimary, fontSize: fontSize.footnote, flex: 1 }}>{playlist.name}</Text>
        <View style={{ width: 100 }}>
          <Button
            title={added ? 'Added ✓' : 'Add'}
            variant="secondary"
            loading={addItem.isPending}
            disabled={added}
            onPress={() => addItem.mutate(lessonId, { onSuccess: () => setAdded(true) })}
          />
        </View>
      </View>
      {addItem.isError ? <InlineError message={getApiErrorMessage(addItem.error, 'Could not add to this playlist.')} /> : null}
    </View>
  );
}

/** One comment in the thread, with its own inline delete-confirm panel — same
 * "plain View/Text panel, no Alert.alert" pattern ConsentTierRow.tsx/
 * MyBookingsScreen.tsx's BookingRow already established (Alert.alert is a
 * documented no-op on React Native Web, this app's own interactive-test
 * target). `deleteComment` is ONE mutation shared across every row in the
 * thread — fine here since realistically only one delete is ever in flight at
 * once on this screen. */
function CommentRow({ comment, deleteComment }: { comment: Comment; deleteComment: ReturnType<typeof useDeleteComment> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={{ paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontWeight: fontWeight.heading, fontSize: fontSize.footnote, color: theme.textPrimary }}>{comment.authorName}</Text>
      <Muted>{formatDateTime(comment.createdAt)}</Muted>
      <Text style={{ color: theme.textPrimary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>{comment.body}</Text>

      {confirming ? (
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button title="Keep" variant="secondary" onPress={() => setConfirming(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Delete"
              variant="destructive"
              loading={deleteComment.isPending}
              onPress={() => {
                setConfirming(false);
                deleteComment.mutate(comment.id);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: spacing[1], width: 100 }}>
          <Button title="Delete" variant="secondary" onPress={() => setConfirming(true)} />
        </View>
      )}
    </View>
  );
}

/** Curriculum learner-facing redesign (Decision 227/254). Shows title,
 * description (unlocked only — the backend already strips it otherwise, same
 * as LessonRow), the video player, a Favorite toggle, an Add-to-Playlist
 * picker, and the comment thread. The full `Lesson` rides in via route params
 * (see navigation/types.ts's own comment) rather than being refetched — there
 * is no student-facing "get one Lesson by id" endpoint to refetch it from
 * anyway.
 *
 * `lesson.locked` gates the Favorite toggle, the video player, and the
 * comment composer — every one of the write endpoints behind them (favorite,
 * watch-progress, comment) 403s server-side for a locked Lesson, and reading
 * comments does too; this is the primary UX, not a bare "let the 403 surface"
 * backstop (per this slice's own task description — the 403 is a defensive
 * backstop only for the one action, Comment delete, that genuinely has no
 * cheap client-side signal to gate on).
 *
 * `isGuardianView` (route.params.studentId set, by LessonsScreen) additionally
 * hides Favorite/Add-to-Playlist/Comments entirely, and skips the watch-progress
 * pings — all of them run under the CALLER's own identity server-side
 * (`assertCanWatchLesson(callerId, ...)`, no guardian-delegation path, Decision
 * 254's own disclosed gap), so for a guardian they'd silently act as the
 * guardian rather than the minor, and 403 outright on any non-free Lesson even
 * though `lesson.locked` (computed for the minor) correctly says it's unlocked.
 * The video itself has no such gate (`playbackUrl` is already on the fetched
 * Lesson), so it keeps playing normally either way. */
export function LessonDetailScreen({ route }: Props) {
  const { lesson, studentId } = route.params;
  const isGuardianView = !!studentId;

  const favorites = useFavorites(isGuardianView ? [] : [lesson.schoolId]);
  const favoriteLesson = useFavoriteLesson(lesson.schoolId, lesson.id);
  const unfavoriteLesson = useUnfavoriteLesson(lesson.schoolId, lesson.id);
  const favorited = favorites.lessonIds.has(lesson.id);

  // Throttled watch-progress: a mutation at most once per ~10 seconds of actual
  // playback time (tracked via a ref, not state — this never needs to trigger a
  // re-render), plus once on completion. `latestTimeRef` is updated on every
  // `timeUpdate` tick regardless of the throttle, so `handleCompleted` always has
  // an accurate last-known position to report even if playback finishes less
  // than 10 seconds after the last saved tick. Skipped entirely in guardian view
  // (see this function's own header comment) — never fires the mutation.
  const upsertProgress = useUpsertWatchProgress(lesson.schoolId, lesson.id);
  const latestTimeRef = useRef(0);
  const lastSavedRef = useRef(0);
  const completedSentRef = useRef(false);

  function handleProgress(seconds: number) {
    latestTimeRef.current = seconds;
    if (isGuardianView) return;
    if (seconds - lastSavedRef.current < 10) return;
    lastSavedRef.current = seconds;
    upsertProgress.mutate({ lastPositionSeconds: Math.round(seconds) });
  }

  function handleCompleted() {
    if (isGuardianView || completedSentRef.current) return;
    completedSentRef.current = true;
    upsertProgress.mutate({ lastPositionSeconds: Math.round(latestTimeRef.current), completed: true });
  }

  function toggleFavorite() {
    if (favoriteLesson.isPending || unfavoriteLesson.isPending) return;
    if (favorited) unfavoriteLesson.mutate();
    else favoriteLesson.mutate();
  }

  // Add to Playlist — a simple expandable section, not a modal/sheet (per this
  // slice's own task description's preference for plain Views over heavier UI
  // patterns). "New playlist" just creates it and lets the now-refetched list
  // show its own Add button like any other playlist, rather than immediately
  // chaining a second mutation to add this Lesson to the brand-new playlist —
  // simpler, and the Student is already looking straight at the picker.
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const playlists = useMyPlaylists();
  const createPlaylist = useCreatePlaylist();

  function handleCreatePlaylist() {
    const name = newPlaylistName.trim();
    if (!name || createPlaylist.isPending) return;
    createPlaylist.mutate(name, { onSuccess: () => setNewPlaylistName('') });
  }

  // Comment thread — oldest first (useComments' own comment explains why).
  // Disabled entirely in guardian view (empty lessonId, useComments' own
  // `enabled: !!lessonId` guard) — even READING the thread 403s under the
  // guardian's own identity for a non-free Lesson (see this screen's own
  // header comment), so there is nothing safe to fetch here.
  const comments = useComments(lesson.schoolId, isGuardianView ? '' : lesson.id);
  const createComment = useCreateComment(lesson.schoolId, lesson.id);
  const deleteComment = useDeleteComment(lesson.schoolId, lesson.id);
  const [commentBody, setCommentBody] = useState('');

  function handlePostComment() {
    const body = commentBody.trim();
    if (!body || createComment.isPending) return;
    createComment.mutate(body, { onSuccess: () => setCommentBody('') });
  }

  const duration = formatDuration(lesson.durationSeconds);
  const commentItems = comments.data?.items ?? [];

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      <Text style={{ fontSize: fontSize.headingMd, fontWeight: fontWeight.heading, color: theme.textPrimary }}>{lesson.title}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing[1], flexWrap: 'wrap' }}>
        {lesson.free ? <Chip label="Free" tone="success" /> : null}
        <Chip label={lesson.format === 'LIVE' ? 'Live' : 'Prerecorded'} tone="accent" />
        {duration ? <Chip label={duration} tone="muted" /> : null}
      </View>

      {lesson.locked ? (
        <Muted>Locked — not included in your current membership.</Muted>
      ) : (
        <>
          {lesson.description ? (
            <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[2] }}>{lesson.description}</Text>
          ) : null}
          <LessonVideoPlayer lesson={lesson} onProgress={handleProgress} onCompleted={handleCompleted} />
        </>
      )}

      {!lesson.locked && !isGuardianView ? (
        <View style={{ marginTop: spacing[3] }}>
          <Button
            title={favorited ? '★ Favorited' : '☆ Favorite'}
            variant={favorited ? 'secondary' : 'primary'}
            loading={favoriteLesson.isPending || unfavoriteLesson.isPending}
            onPress={toggleFavorite}
          />
          {favoriteLesson.isError || unfavoriteLesson.isError ? (
            <InlineError message={getApiErrorMessage(favoriteLesson.error ?? unfavoriteLesson.error, 'Could not update favorite.')} />
          ) : null}
        </View>
      ) : null}

      {!isGuardianView ? (
        <View style={{ marginTop: spacing[3] }}>
          <Button
            title={playlistPickerOpen ? 'Hide playlists' : 'Add to Playlist'}
            variant="secondary"
            onPress={() => setPlaylistPickerOpen((open) => !open)}
          />
          {playlistPickerOpen ? (
            <View style={{ marginTop: spacing[2] }}>
              {playlists.isLoading ? <ActivityIndicator /> : null}
              {playlists.isError && !playlists.data ? (
                <ErrorBanner message={getApiErrorMessage(playlists.error, 'Could not load your playlists.')} />
              ) : null}
              {(playlists.data?.items ?? []).map((p) => (
                <PlaylistOption key={p.id} playlist={p} lessonId={lesson.id} />
              ))}
              <View style={{ marginTop: spacing[2] }}>
                <TextField value={newPlaylistName} onChangeText={setNewPlaylistName} placeholder="New playlist name" />
                <Button title="Create playlist" variant="secondary" loading={createPlaylist.isPending} disabled={!newPlaylistName.trim()} onPress={handleCreatePlaylist} />
                {createPlaylist.isError ? <InlineError message={getApiErrorMessage(createPlaylist.error, 'Could not create this playlist.')} /> : null}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: spacing[6] }}>
        <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, color: theme.textPrimary, marginBottom: spacing[2] }}>
          Comments
        </Text>

        {isGuardianView ? (
          <Muted>Favorites, Playlists, and Comments aren't available yet while viewing on behalf of a linked Student.</Muted>
        ) : (
          <>
            {comments.isLoading ? <ActivityIndicator /> : null}
            {comments.isError && !comments.data ? (
              <ErrorBanner message={getApiErrorMessage(comments.error, 'Could not load comments.')} />
            ) : null}
            {!comments.isLoading && commentItems.length === 0 ? <Muted>No comments yet.</Muted> : null}

            {commentItems.map((c) => (
              <CommentRow key={c.id} comment={c} deleteComment={deleteComment} />
            ))}
            {deleteComment.isError ? <InlineError message={getApiErrorMessage(deleteComment.error, 'Could not delete this comment.')} /> : null}

            {lesson.locked ? (
              <Muted>Comments are unavailable for a locked Lesson.</Muted>
            ) : (
              <View style={{ marginTop: spacing[2] }}>
                <TextField
                  value={commentBody}
                  onChangeText={setCommentBody}
                  placeholder="Add a comment…"
                  multiline
                  numberOfLines={3}
                  maxLength={2000}
                />
                <Button title="Post" loading={createComment.isPending} disabled={!commentBody.trim()} onPress={handlePostComment} />
                {createComment.isError ? <InlineError message={getApiErrorMessage(createComment.error, 'Could not post this comment.')} /> : null}
              </View>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}
