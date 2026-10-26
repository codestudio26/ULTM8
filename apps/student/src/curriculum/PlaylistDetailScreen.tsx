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
import { useT } from '../i18n/I18nProvider';

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
  const t = useT();
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
        <ErrorBanner message={getApiErrorMessage(error, t('curriculum.playlistDetail.loadError'))} />
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
      setMoveError(getApiErrorMessage(err, t('curriculum.playlistDetail.reorderError')));
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
          <TextField value={renameValue} onChangeText={setRenameValue} placeholder={t('curriculum.playlistDetail.namePlaceholder')} />
          {renamePlaylist.isError ? (
            <InlineError message={getApiErrorMessage(renamePlaylist.error, t('curriculum.playlistDetail.renameError'))} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button
                title={t('curriculum.playlistDetail.cancel')}
                variant="secondary"
                onPress={() => {
                  setRenaming(false);
                  setRenameValue(name);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('curriculum.playlistDetail.save')} onPress={handleRename} loading={renamePlaylist.isPending} disabled={!renameValue.trim()} />
            </View>
          </View>
        </View>
      ) : (
        <Button title={t('curriculum.playlistDetail.rename')} variant="secondary" onPress={() => setRenaming(true)} />
      )}

      {moveError ? <InlineError message={moveError} /> : null}
      {items.length === 0 ? (
        <Text style={{ color: theme.textSecondary, marginTop: spacing[3] }}>{t('curriculum.playlistDetail.empty')}</Text>
      ) : null}

      {items.map((item, i) => (
        <View key={item.id} style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.heading, color: theme.textPrimary }}>{item.available ? item.lessonTitle : t('curriculum.playlistDetail.unavailable')}</Text>
          {item.available && item.locked ? <Muted>{t('curriculum.playlistDetail.locked')}</Muted> : null}
          <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button title={t('curriculum.playlistDetail.moveUp')} variant="secondary" disabled={i === 0 || reorderItems.isPending} onPress={() => moveItem(i, -1)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('curriculum.playlistDetail.moveDown')}
                variant="secondary"
                disabled={i === items.length - 1 || reorderItems.isPending}
                onPress={() => moveItem(i, 1)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('curriculum.playlistDetail.remove')} variant="secondary" loading={removeItem.isPending} onPress={() => removeItem.mutate(item.id)} />
            </View>
          </View>
        </View>
      ))}
      {removeItem.isError ? <InlineError message={getApiErrorMessage(removeItem.error, t('curriculum.playlistDetail.removeError'))} /> : null}

      <View style={{ marginTop: spacing[6] }}>
        {deletingPlaylist ? (
          <View>
            <Text style={{ color: theme.textDanger, fontSize: fontSize.footnote }}>{t('curriculum.playlistDetail.deleteConfirm')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
              <View style={{ flex: 1 }}>
                <Button title={t('curriculum.playlistDetail.keep')} variant="secondary" onPress={() => setDeletingPlaylist(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t('curriculum.playlistDetail.delete')} variant="destructive" loading={deletePlaylist.isPending} onPress={handleDeletePlaylist} />
              </View>
            </View>
          </View>
        ) : (
          <Button title={t('curriculum.playlistDetail.delete')} variant="destructive" onPress={() => setDeletingPlaylist(true)} />
        )}
        {deletePlaylist.isError ? <InlineError message={getApiErrorMessage(deletePlaylist.error, t('curriculum.playlistDetail.deleteError'))} /> : null}
      </View>
    </Screen>
  );
}
