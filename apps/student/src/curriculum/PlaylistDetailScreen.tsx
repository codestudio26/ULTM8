import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, InlineError, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import {
  useDeletePlaylist,
  usePlaylistItems,
  useRemovePlaylistItem,
  useRenamePlaylist,
  useReorderPlaylistItems,
} from './playlistQueries';

type Props = NativeStackScreenProps<AppStackParamList, 'PlaylistDetail'>;

const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>
);

/** One Playlist's items — title, locked state, a remove button, and simple
 * up/down reorder buttons. Adjacent-swap, not drag-and-drop — the same
 * convention apps/school-portal's CurriculumPage.tsx already uses for
 * Lesson/category ordering (confirmed as this codebase's established pattern
 * for simple reordering UI, per this slice's own task description).
 * `PUT .../items/order` requires EVERY item in the playlist exactly once, so
 * `moveItem` always sends the full, reordered id list, never a partial one.
 *
 * Playlist items (`PlaylistItemResponseDto`) don't carry enough of a Lesson's
 * shape (no `videoRef`/`captionStatus`/etc.) to navigate into
 * LessonDetailScreen, which needs the full `Lesson` via route params and has
 * no "get one Lesson by id" endpoint to refetch from — so these rows are
 * deliberately not tappable into the detail screen, unlike LessonRow on
 * LessonsScreen. */
export function PlaylistDetailScreen({ route, navigation }: Props) {
  const { playlistId, name } = route.params;
  const { data, isLoading, isError, error } = usePlaylistItems(playlistId);
  const removeItem = useRemovePlaylistItem(playlistId);
  const reorderItems = useReorderPlaylistItems(playlistId);
  const renamePlaylist = useRenamePlaylist(playlistId);
  const deletePlaylist = useDeletePlaylist();

  const [moveError, setMoveError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [deletingPlaylist, setDeletingPlaylist] = useState(false);

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (isError && !data) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, 'Could not load this playlist — please try again.')} />
      </Screen>
    );
  }

  const items = (data?.items ?? []).slice().sort((a, b) => a.order - b.order);

  async function moveItem(index: number, delta: number) {
    const ids = items.map((i) => i.id);
    const j = index + delta;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setMoveError(null);
    try {
      await reorderItems.mutateAsync(ids);
    } catch (err) {
      setMoveError(getApiErrorMessage(err, 'Could not reorder this playlist.'));
    }
  }

  function handleRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || renamePlaylist.isPending) return;
    renamePlaylist.mutate(trimmed, {
      onSuccess: () => {
        setRenaming(false);
        // Keeps the nav header (set from the route param at navigation time,
        // same fixed-at-navigate-time pattern GradingHistoryScreen's own
        // `title` param uses) in sync with the new name.
        navigation.setParams({ name: trimmed });
      },
    });
  }

  function handleDeletePlaylist() {
    if (deletePlaylist.isPending) return;
    deletePlaylist.mutate(playlistId, { onSuccess: () => navigation.goBack() });
  }

  return (
    <Screen>
      {renaming ? (
        <View style={{ marginBottom: spacing[4] }}>
          <TextField value={renameValue} onChangeText={setRenameValue} placeholder="Playlist name" />
          {renamePlaylist.isError ? (
            <InlineError message={getApiErrorMessage(renamePlaylist.error, 'Could not rename this playlist.')} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setRenaming(false);
                  setRenameValue(name);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Save" onPress={handleRename} loading={renamePlaylist.isPending} disabled={!renameValue.trim()} />
            </View>
          </View>
        </View>
      ) : (
        <Button title="Rename playlist" variant="secondary" onPress={() => setRenaming(true)} />
      )}

      {moveError ? <InlineError message={moveError} /> : null}
      {items.length === 0 ? (
        <Text style={{ color: theme.textSecondary, marginTop: spacing[3] }}>No lessons in this playlist yet.</Text>
      ) : null}

      {items.map((item, i) => (
        <View key={item.id} style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.heading, color: theme.textPrimary }}>{item.available ? item.lessonTitle : 'No longer available'}</Text>
          {item.available && item.locked ? <Muted>Locked</Muted> : null}
          <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button title="↑ Up" variant="secondary" disabled={i === 0 || reorderItems.isPending} onPress={() => moveItem(i, -1)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="↓ Down"
                variant="secondary"
                disabled={i === items.length - 1 || reorderItems.isPending}
                onPress={() => moveItem(i, 1)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Remove" variant="secondary" loading={removeItem.isPending} onPress={() => removeItem.mutate(item.id)} />
            </View>
          </View>
        </View>
      ))}
      {removeItem.isError ? <InlineError message={getApiErrorMessage(removeItem.error, 'Could not remove this item.')} /> : null}

      <View style={{ marginTop: spacing[6] }}>
        {deletingPlaylist ? (
          <View>
            <Text style={{ color: theme.textDanger, fontSize: fontSize.footnote }}>Delete this playlist? This cannot be undone.</Text>
            <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
              <View style={{ flex: 1 }}>
                <Button title="Keep playlist" variant="secondary" onPress={() => setDeletingPlaylist(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Delete playlist" variant="destructive" loading={deletePlaylist.isPending} onPress={handleDeletePlaylist} />
              </View>
            </View>
          </View>
        ) : (
          <Button title="Delete playlist" variant="destructive" onPress={() => setDeletingPlaylist(true)} />
        )}
        {deletePlaylist.isError ? <InlineError message={getApiErrorMessage(deletePlaylist.error, 'Could not delete this playlist.')} /> : null}
      </View>
    </Screen>
  );
}
