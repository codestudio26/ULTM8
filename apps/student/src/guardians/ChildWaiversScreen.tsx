import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { WaiverRow } from '../waivers/WaiverRow';
import { useMinorWaivers } from '../waivers/waiverQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'ChildWaivers'>;

/** Decision 428 (Student portal review M1) — a parent reads and signs their
 * child's waivers at each of the child's Schools. A School that needs a
 * signed waiver before booking refuses the child's booking until then. */
export function ChildWaiversScreen({ route }: Props) {
  const { studentId, name, schoolId: onlySchoolId } = route.params;
  const t = useT();
  const waivers = useMinorWaivers(studentId);

  if (waivers.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (waivers.isError && !waivers.data) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(waivers.error, t('guardians.childWaivers.loadError'))} />
      </Screen>
    );
  }

  // From "Sign the waiver" (Decision 442 item 1): only that School's waivers.
  const all = waivers.data?.items ?? [];
  const items = onlySchoolId && all.some((w) => w.schoolId === onlySchoolId) ? all.filter((w) => w.schoolId === onlySchoolId) : all;
  if (items.length === 0) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>{t('guardians.childWaivers.empty', { name })}</Text>
      </Screen>
    );
  }

  const schoolOrder: string[] = [];
  const bySchool = new Map<string, typeof items>();
  for (const w of items) {
    if (!bySchool.has(w.schoolId)) {
      schoolOrder.push(w.schoolId);
      bySchool.set(w.schoolId, []);
    }
    bySchool.get(w.schoolId)!.push(w);
  }

  return (
    <ScrollView>
      <Screen>
        {schoolOrder.map((schoolId) => (
          <View key={schoolId} style={{ marginBottom: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 4 }}>{bySchool.get(schoolId)![0]!.schoolName}</Text>
            {bySchool.get(schoolId)!.map((w) => (
              <WaiverRow
                key={w.id}
                waiver={w}
                signature={w.signedDate ? { signedDate: w.signedDate } : undefined}
                forStudentId={studentId}
                forName={name}
                childMaySign={w.childMaySign}
              />
            ))}
          </View>
        ))}
      </Screen>
    </ScrollView>
  );
}
