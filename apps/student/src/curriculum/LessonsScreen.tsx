import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useEnrolledSchoolNames } from '../waivers/waiverQueries';
import { useLessonCategoryOrder, useLessonsOverviewForStudent, type Lesson } from './curriculumQueries';
import { LessonRow } from './LessonRow';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Lessons'>;

const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>
);

/** Off Home, alongside Waivers/My Bookings — the real, already-shipped
 * CurriculumModule's (Phase 44) Student/Guardian-facing endpoint,
 * `GET /students/:id/lessons`, for the student themselves or a guardian of
 * theirs (Decisions 154, 190, 195). One unified fetch either way
 * (`useLessonsOverviewForStudent`, schoolId omitted — every enrolled School
 * at once) — same `route.params?.studentId ?? claims?.sub` shape
 * `MyGradingScreen` already established for the identical "a guardian's own
 * JWT carries no claims about a linked minor's enrollment" problem, closing
 * the gap curriculumQueries.ts previously flagged (docs/TRACK-B-ROADMAP.md).
 *
 * Grouped by School (when more than one — School ids collected from the
 * Lessons response itself, in first-seen order), then by category in the
 * School's own authored order (`category`/`order`, set by Staff on
 * CurriculumPage) — matching how Staff actually built the catalogue, not an
 * arbitrary flat list. Lessons with no category sort last, under "Other",
 * mirroring CurriculumPage's own "No category" bucket. */
export function LessonsScreen({ route }: Props) {
  const { claims } = useAuth();
  const studentId = route.params?.studentId ?? claims?.sub ?? null;
  const lessons = useLessonsOverviewForStudent(studentId);
  const items = lessons.data?.items ?? [];

  const schoolIds: string[] = [];
  const bySchool = new Map<string, Lesson[]>();
  for (const lesson of items) {
    if (!bySchool.has(lesson.schoolId)) schoolIds.push(lesson.schoolId);
    const list = bySchool.get(lesson.schoolId) ?? [];
    list.push(lesson);
    bySchool.set(lesson.schoolId, list);
  }
  const schoolNames = useEnrolledSchoolNames(schoolIds);
  const categoryOrder = useLessonCategoryOrder(schoolIds);

  if (lessons.isLoading) {
    return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  }

  if (lessons.isError && items.length === 0) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(lessons.error, 'Failed to load lessons — please try again.')} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface0, padding: spacing[4] + spacing[1] }}>
        <Muted>No lessons yet.</Muted>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {schoolIds.map((schoolId) => (
        <View key={schoolId} style={{ marginBottom: spacing[6] }}>
          {schoolIds.length > 1 ? (
            <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, color: theme.textPrimary, marginBottom: spacing[2] }}>
              {schoolNames.get(schoolId) ?? schoolId}
            </Text>
          ) : null}
          <SchoolLessons lessons={bySchool.get(schoolId)!} categoryOrder={categoryOrder} />
        </View>
      ))}
    </ScrollView>
  );
}

function SchoolLessons({ lessons, categoryOrder }: { lessons: Lesson[]; categoryOrder: Map<string, number> }) {
  const byCategory = new Map<string, Lesson[]>();
  const uncategorised: Lesson[] = [];
  for (const lesson of lessons) {
    if (!lesson.categoryId || !lesson.category) {
      uncategorised.push(lesson);
      continue;
    }
    const list = byCategory.get(lesson.categoryId) ?? [];
    list.push(lesson);
    byCategory.set(lesson.categoryId, list);
  }

  const categories = Array.from(byCategory.entries()).map(([categoryId, items]) => ({
    categoryId,
    name: items[0].category!,
    // The category's OWN position among the School's categories — not `order`
    // on a Lesson, which is a different number (a Lesson's place within its
    // category). Falls back to the end of the list for the moment right
    // after a category's own fetch hasn't settled yet (see
    // useLessonCategoryOrder's header comment).
    categoryOrder: categoryOrder.get(categoryId) ?? Number.MAX_SAFE_INTEGER,
    items: items.slice().sort((a, b) => a.order - b.order),
  }));
  categories.sort((a, b) => a.categoryOrder - b.categoryOrder);

  return (
    <>
      {categories.map((c) => (
        <View key={c.categoryId} style={{ marginBottom: spacing[4] }}>
          <Text style={{ fontWeight: fontWeight.heading, fontSize: fontSize.footnote, color: theme.textSecondary, marginBottom: spacing[1] }}>
            {c.name}
          </Text>
          {c.items.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
        </View>
      ))}
      {uncategorised.length > 0 ? (
        <View>
          {categories.length > 0 ? (
            <Text style={{ fontWeight: fontWeight.heading, fontSize: fontSize.footnote, color: theme.textSecondary, marginBottom: spacing[1] }}>
              Other
            </Text>
          ) : null}
          {uncategorised
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} />
            ))}
        </View>
      ) : null}
    </>
  );
}
