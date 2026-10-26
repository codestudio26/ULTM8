import React from 'react';
import { Text, View } from 'react-native';
import { useQueries } from '@tanstack/react-query';
import { Button } from '../components/ui';
import { formatMoney } from '../lib/formatMoney';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import { feeRequestsQuery, isFeeToAnswer, type FeeRequest } from './myGradingQueries';

/** Whose fees to show: the signed-in student (no name), and a guardian's children. */
export interface FeePerson {
  studentId: string;
  /** The child's first name; null for the signed-in student. */
  childName: string | null;
}

/**
 * The Home "Promotion fee" card (DESIGN.md → student app, Home; Decisions 287,
 * 300): one card per fee still waiting for an answer, for the student and for
 * each of a guardian's children. "See and answer" opens My grading with that
 * fee's answer already open; nothing is answered from Home itself.
 */
export function HomeFeeCards({ people, onAnswer }: { people: FeePerson[]; onAnswer: (person: FeePerson, request: FeeRequest) => void }) {
  const t = useT();
  const results = useQueries({ queries: people.map((p) => feeRequestsQuery(p.studentId)) });
  const cards = people.flatMap((person, i) => (results[i]?.data?.items ?? []).filter(isFeeToAnswer).map((request) => ({ person, request })));
  if (cards.length === 0) return null;

  return (
    <>
      {cards.map(({ person, request: r }) => (
        <View
          key={r.id}
          accessibilityLabel={t('grading.fee.a11yLabel', { rank: r.toRungName })}
          style={{ marginBottom: spacing[4], backgroundColor: theme.bgWarning, borderRadius: radius.button, padding: spacing[4] }}
        >
          <Text accessibilityRole="header" style={{ fontWeight: '600', color: theme.textWarning }}>
            {t('grading.fee.title')}
          </Text>
          <Text style={{ fontWeight: '600', marginTop: spacing[1] }}>
            {person.childName
              ? t('grading.fee.gradedChild', { name: person.childName, rank: r.toRungName })
              : t('grading.fee.gradedSelf', { rank: r.toRungName })}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>
            {r.disciplineName && r.schoolName
              ? t('grading.fee.styleAtSchoolAmount', { style: r.disciplineName, school: r.schoolName, amount: formatMoney(r.amountMinor, r.currency) })
              : t('grading.fee.placeAmount', { place: r.disciplineName ?? r.schoolName ?? '', amount: formatMoney(r.amountMinor, r.currency) })}
          </Text>
          <Button title={t('grading.fee.seeAndAnswer')} variant="secondary" onPress={() => onAnswer(person, r)} />
        </View>
      ))}
    </>
  );
}
