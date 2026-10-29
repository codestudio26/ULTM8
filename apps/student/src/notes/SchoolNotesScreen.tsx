import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import type { AppStackParamList } from '../navigation/types';
import { useMemberNotes } from './notesQueries';

type Props = NativeStackScreenProps<AppStackParamList, 'SchoolNotes'>;

/**
 * Notes from the School (backlog 3.10, Decision 400): the staff notes ticked
 * "Show to member", newest first, from every School the student is at. A
 * Guardian opens it from their child's row and sees the child's notes.
 */
export function SchoolNotesScreen({ route }: Props) {
  const t = useT();
  const notes = useMemberNotes(route.params?.studentId);
  if (notes.isLoading) return <ActivityIndicator testID="activity-indicator" />;
  if (notes.isError && !notes.data) return <Screen><ErrorBanner message={getApiErrorMessage(notes.error, t('home.notesScreen.loadError'))} /></Screen>;
  const items = notes.data?.items ?? [];
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
        {items.length === 0 ? <Text style={{ color: theme.textMuted }}>{t('home.notesScreen.empty')}</Text> : null}
        {items.map((n) => (
          <View key={n.id} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 16, backgroundColor: theme.surface1, gap: 6 }}>
            <Text style={{ fontWeight: '700' }}>{n.schoolName}</Text>
            <Text>{n.body}</Text>
            <Text style={{ fontSize: 12, color: theme.textMuted }}>
              {n.authorName ? t('home.notesScreen.by', { name: n.authorName, date: formatDate(n.createdAt) }) : formatDate(n.createdAt)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
