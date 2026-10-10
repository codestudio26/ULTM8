import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, minTouchTarget } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useGradingBoard, useStyleRanks, type BoardColumn, type GradingBoardItem } from './coachQueries';
import { flattenLadder } from './ladder';
import { Muted, Section } from './parts';

type Props = NativeStackScreenProps<AppStackParamList, 'GradingBoard'>;

const COLUMNS: Array<{ id: BoardColumn; title: string }> = [
  { id: 'READY_TO_GRADE', title: 'Ready to Grade' },
  { id: 'GETTING_THERE', title: 'Getting There' },
  { id: 'JUST_STARTING', title: 'Just Starting' },
];

/**
 * The Grading Board for one style, on a phone (Decisions 128 item 5, 136, 184):
 * the coach's students in three columns, highest progress first, with search
 * and the active-only filter. Tapping a student opens their grading panel.
 * Bulk promote, dragging between columns and the column % stay on the web
 * portal for now.
 */
export function GradingBoardScreen({ route, navigation }: Props) {
  const { schoolId, disciplineId, name } = route.params;
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState('');
  const board = useGradingBoard(schoolId, disciplineId, activeOnly);
  const ranks = useStyleRanks(disciplineId);
  const rungName = useMemo(() => new Map(flattenLadder(ranks.data?.items ?? []).map((r) => [r.id, r.name])), [ranks.data]);

  const q = search.trim().toLowerCase();
  const items = (board.data?.items ?? []).filter((i) => !q || `${i.firstName} ${i.surname}`.toLowerCase().includes(q));

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }} keyboardShouldPersistTaps="handled">
      <TextField placeholder="Search students" value={search} onChangeText={setSearch} accessibilityLabel="Search students" autoCorrect={false} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing[3] }}>
        <Text>Active students only</Text>
        <Switch value={activeOnly} onValueChange={setActiveOnly} accessibilityLabel="Active students only" />
      </View>
      {activeOnly && (board.data?.hiddenInactive ?? 0) > 0 ? <Muted>{board.data!.hiddenInactive} inactive hidden</Muted> : null}
      {board.isLoading ? (
        <ActivityIndicator />
      ) : board.error ? (
        <InlineError message={getApiErrorMessage(board.error, 'Could not load the board.')} />
      ) : (
        COLUMNS.map((col) => {
          const inColumn = items.filter((i) => i.eligibility.boardColumn === col.id);
          return (
            <Section key={col.id} title={`${col.title} (${inColumn.length})`}>
              {inColumn.length === 0 ? <Muted>{q ? 'No match.' : 'Nobody here.'}</Muted> : null}
              {inColumn.map((item) => (
                <StudentCard
                  key={item.studentId}
                  item={item}
                  rungName={rungName.get(item.currentStripeId ?? '') ?? ''}
                  onPress={() => navigation.navigate('CoachStudent', { schoolId, disciplineId, studentId: item.studentId, name: `${item.firstName} ${item.surname}`, styleName: name })}
                />
              ))}
            </Section>
          );
        })
      )}
    </ScrollView>
  );
}

function StudentCard({ item, rungName, onPress }: { item: GradingBoardItem; rungName: string; onPress: () => void }) {
  const e = item.eligibility;
  const flags = [
    item.verificationStatus === 'UNVERIFIED' ? 'Belt not verified' : null,
    !item.active ? 'Inactive' : null,
    (e.missingSkillIds?.length ?? 0) > 0 ? 'Skills not signed off' : null,
    e.daysOk === false ? 'Too early' : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.firstName} ${item.surname}`}
      onPress={onPress}
      style={{ minHeight: minTouchTarget, paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border }}
    >
      <Text style={{ fontWeight: '600' }}>
        {item.firstName} {item.surname}
      </Text>
      <Muted>
        {rungName ? `${rungName} · ` : ''}
        {e.progressPercent ?? 0}%{flags.length ? ` · ${flags.join(' · ')}` : ''}
      </Muted>
    </Pressable>
  );
}
