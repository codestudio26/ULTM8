import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, InlineError, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useCreatePlaylist, useMyPlaylists } from './playlistQueries';
import { useT } from '../i18n/I18nProvider';

type Props = NativeStackScreenProps<AppStackParamList, 'Playlists'>;

/** The caller's own Playlists (Curriculum learner-facing redesign, Decision
 * 227/254) — reached from a "My Playlists" button on LessonsScreen, per this
 * app's established "plain stack reached via buttons on other screens, not a
 * tab bar" navigation shape (AppNavigator.tsx). Deliberately no per-playlist
 * item count here — that would mean one extra `findPlaylistItems` request per
 * playlist just to show a number; the task description explicitly leaves this
 * as a judgment call ("your call, keep it simple"), and a count isn't needed
 * to use this screen (tapping a row already shows its items). */
export function PlaylistsScreen({ navigation }: Props) {
  const t = useT();
  const { data, isLoading, isError, error } = useMyPlaylists();
  const createPlaylist = useCreatePlaylist();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

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
        <ErrorBanner message={getApiErrorMessage(error, t('curriculum.playlists.loadError'))} />
      </Screen>
    );
  }

  const playlists = data?.items ?? [];

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || createPlaylist.isPending) return;
    createPlaylist.mutate(trimmed, {
      onSuccess: () => {
        setName('');
        setCreating(false);
      },
    });
  }

  return (
    <Screen>
      {playlists.length === 0 ? <Text style={{ color: theme.textSecondary, marginBottom: spacing[3] }}>{t('curriculum.playlists.empty')}</Text> : null}

      {playlists.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => navigation.navigate('PlaylistDetail', { playlistId: p.id, name: p.name })}
          accessibilityRole="button"
          style={({ pressed }) => [
            { paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.heading, color: theme.textPrimary }}>{p.name}</Text>
        </Pressable>
      ))}

      {creating ? (
        <View style={{ marginTop: spacing[4] }}>
          <TextField value={name} onChangeText={setName} placeholder={t('curriculum.playlists.namePlaceholder')} />
          {createPlaylist.isError ? (
            <InlineError message={getApiErrorMessage(createPlaylist.error, t('curriculum.playlists.createError'))} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button
                title={t('curriculum.playlists.cancel')}
                variant="secondary"
                onPress={() => {
                  setCreating(false);
                  setName('');
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('curriculum.playlists.create')} onPress={handleCreate} loading={createPlaylist.isPending} disabled={!name.trim()} />
            </View>
          </View>
        </View>
      ) : (
        <Button title={t('curriculum.playlists.newPlaylist')} variant="secondary" onPress={() => setCreating(true)} />
      )}
    </Screen>
  );
}
