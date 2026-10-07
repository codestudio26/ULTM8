import React from 'react';
import { Pressable, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useAcademies } from './academyQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Academies'>;
type AcademySummary = components['schemas']['AcademySummaryDto'];

export function AcademiesListScreen({ navigation }: Props) {
  const query = useAcademies();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: AcademySummary) => (
        <Pressable
          onPress={() => navigation.navigate('AcademyDetail', { academyId: item.id, name: item.name })}
          style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}
        >
          <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.heading }}>{item.name}</Text>
          {item.address ? <Text style={{ color: theme.textSecondary, marginTop: spacing[1] }}>{item.address}</Text> : null}
          {item.activities.length ? (
            <Text style={{ color: theme.textSecondary, marginTop: spacing[1], fontSize: fontSize.caption }}>
              {item.activities.join(' · ')}
            </Text>
          ) : null}
        </Pressable>
      )}
      emptyMessage="No academies found."
      errorFallbackMessage="Failed to load academies — please try again."
    />
  );
}
