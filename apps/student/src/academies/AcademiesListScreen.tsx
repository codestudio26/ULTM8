import React from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type components } from '@ultm8/api-client';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useAcademies } from './academyQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Academies'>;
type AcademySummary = components['schemas']['AcademySummaryDto'];

export function AcademiesListScreen({ navigation }: Props) {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useAcademies();
  const academies: AcademySummary[] = data?.pages.flatMap((p) => p.items) ?? [];

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, 'Failed to load academies — please try again.')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={academies}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator /> : null}
        ListEmptyComponent={<Text style={{ color: '#5F6368' }}>No academies found.</Text>}
        renderItem={({ item }) => (
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
      />
    </Screen>
  );
}
