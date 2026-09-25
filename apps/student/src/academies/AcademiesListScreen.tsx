import React from 'react';
import { Pressable, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
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
          style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
          {item.address ? <Text style={{ color: '#5F6368', marginTop: 2 }}>{item.address}</Text> : null}
          {item.activities.length ? (
            <Text style={{ color: '#5F6368', marginTop: 2, fontSize: 12 }}>{item.activities.join(' · ')}</Text>
          ) : null}
        </Pressable>
      )}
      emptyMessage="No academies found."
      errorFallbackMessage="Failed to load academies — please try again."
    />
  );
}
