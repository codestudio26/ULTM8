import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useEnrolledSchoolNames } from '../waivers/waiverQueries';
import {
  useFavorites,
  useLessonCategoryOrder,
  useLessonsOverviewForStudent,
  useWatchHistory,
  type Lesson,
  type WatchHistoryEntry,
} from './curriculumQueries';
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
 * mirroring CurriculumPage's own "No category" bucket.
 *
 * Curriculum learner-facing redesign (Decision 227/254): adds a "Continue
 * watching" section above the School grouping (only shown when there's
 * genuinely something in progress — no empty-state clutter for a Student who
 * hasn't started watching anything), a "My Playlists" entry point (this app's
 * nav is a plain stack reached via buttons on other screens, not a tab bar —
 * AppNavigator.tsx's own existing shape), and a favorited-lessonIds lookup
 * fetched ONCE for the whole screen and passed down to every LessonRow (no
 * N+1 favorites fetch per row).
 *
 * All three are deliberately SELF-scoped only (`isGuardianView` below) —
 * Favorite/WatchHistory/Playlist have no guardian-delegation path server-side
 * (Decision 254's own disclosed gap: "Guardian-viewing-a-linked-minor's ...
 * Favorites/WatchHistory/Playlists is explicitly not built"). Showing them
 * while a guardian views a linked minor's Lessons would silently reflect the
 * GUARDIAN's own (almost always empty) favorites/progress, not the minor's —
 * found while wiring the Guardian-Lessons fix itself, fixed here by simply not
 * fetching/rendering them rather than showing something misleading. */
export function LessonsScreen({ route, navigation }: Props) {
  const { claims } = useAuth();
  const viewingStudentId = route.params?.studentId;
  const isGuardianView = !!viewingStudentId;
  const studentId = viewingStudentId ?? claims?.sub ?? null;
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
  const favorites = useFavorites(isGuardianView ? [] : schoolIds);
  const watchHistory = useWatchHistory(isGuardianView ? [] : schoolIds);

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

  // "Continue watching" = genuinely in-progress only: not yet completed, and the
  // Lesson it points at is still in the already-fetched catalogue (skips a stale
  // entry for a Lesson that's been removed/archived since). WatchHistoryResponseDto
  // doesn't carry a title, hence the cross-reference against `items`. Each School's
  // own list already comes back most-recently-updated-first, but merging several
  // Schools' lists loses that global order, so re-sort after merging.
  const lessonById = new Map(items.map((l) => [l.id, l] as const));
  const continueWatching: { entry: WatchHistoryEntry; lesson: Lesson }[] = watchHistory.items
    .filter((entry) => !entry.completedAt && lessonById.has(entry.lessonId))
    .map((entry) => ({ entry, lesson: lessonById.get(entry.lessonId)! }))
    .sort((a, b) => new Date(b.entry.updatedAt).getTime() - new Date(a.entry.updatedAt).getTime())
    .slice(0, 10);

  function openLesson(lesson: Lesson) {
    navigation.navigate('LessonDetail', { lessonId: lesson.id, lesson, studentId: viewingStudentId });
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {!isGuardianView ? <Button title="My Playlists" variant="secondary" onPress={() => navigation.navigate('Playlists')} /> : null}

      {continueWatching.length > 0 ? (
        <View style={{ marginTop: spacing[4], marginBottom: spacing[6] }}>
          <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, color: theme.textPrimary, marginBottom: spacing[2] }}>
            Continue watching
          </Text>
          {continueWatching.map(({ entry, lesson }) => (
            <Pressable
              key={entry.id}
              onPress={() => openLesson(lesson)}
              accessibilityRole="button"
              style={({ pressed }) => [
                { paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border },
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <Text style={{ fontWeight: fontWeight.heading, fontSize: fontSize.body, color: theme.textPrimary }}>{lesson.title}</Text>
              <Muted>Continue watching</Muted>
            </Pressable>
          ))}
        </View>
      ) : null}

      {items.length === 0 ? (
        <Muted>No lessons yet.</Muted>
      ) : (
        schoolIds.map((schoolId) => (
          <View key={schoolId} style={{ marginBottom: spacing[6] }}>
            {schoolIds.length > 1 ? (
              <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, color: theme.textPrimary, marginBottom: spacing[2] }}>
                {schoolNames.get(schoolId) ?? schoolId}
              </Text>
            ) : null}
            <SchoolLessons
              lessons={bySchool.get(schoolId)!}
              categoryOrder={categoryOrder}
              favoritedIds={favorites.lessonIds}
              onPressLesson={openLesson}
            />
          </View>
        ))
      )}
    </ScrollView>
  );
}

function SchoolLessons({
  lessons,
  categoryOrder,
  favoritedIds,
  onPressLesson,
}: {
  lessons: Lesson[];
  categoryOrder: Map<string, number>;
  favoritedIds: Set<string>;
  onPressLesson: (lesson: Lesson) => void;
}) {
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
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              favorited={favoritedIds.has(lesson.id)}
              onPress={() => onPressLesson(lesson)}
            />
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
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                favorited={favoritedIds.has(lesson.id)}
                onPress={() => onPressLesson(lesson)}
              />
            ))}
        </View>
      ) : null}
    </>
  );
}
