import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { theme, spacing, fontSize, fontWeight, radius } from '../theme/tokens';
import type { Lesson } from './curriculumQueries';
import { useT } from '../i18n/I18nProvider';

const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>
);

/** Exported — LessonDetailScreen.tsx reuses this for its own format/duration
 * chip row rather than duplicating it. */
export function Chip({ label, tone }: { label: string; tone: 'accent' | 'success' | 'muted' }) {
  const bg = tone === 'success' ? theme.bgSuccess : tone === 'accent' ? theme.border : theme.surface0;
  const fg = tone === 'success' ? theme.textSuccess : tone === 'accent' ? theme.textAccent : theme.textSecondary;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.input, paddingHorizontal: spacing[2], paddingVertical: 2, marginRight: spacing[1] }}>
      <Text style={{ color: fg, fontSize: fontSize.caption, fontWeight: fontWeight.emphasis }}>{label}</Text>
    </View>
  );
}

/** "4:30", or "1:05:00" from an hour up — the same as the School Portal
 * (Decision 326). */
export function formatDuration(totalSeconds: number | null | undefined): string | null {
  if (!totalSeconds) return null;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** One Lesson on LessonsScreen — title, category context (shown once per group by
 * the parent, not repeated per row), and the metadata every Lesson always carries
 * regardless of lock state (`format`/`durationSeconds`/`free`/`locked`, per
 * `shapeLessonResponse`'s confirmed always-visible field set). A locked Lesson's
 * `description` is already stripped by the backend (null, not just hidden here),
 * so this only ever renders a description when the backend actually sent one.
 *
 * Tappable (`Pressable`, same pattern MyMinorsScreen's row already uses) — navigates
 * to LessonDetailScreen, where video playback, the Favorite toggle, Add-to-Playlist,
 * and the comment thread all live (Curriculum learner-facing redesign, Decision
 * 227/254). `favorited` is a prop, not a hook called here — fetched ONCE for the
 * whole LessonsScreen (`useFavorites`) and passed down as a `Set<string>` lookup, per
 * this slice's own task description (no N+1 favorites fetch per row). */
export function LessonRow({
  lesson,
  favorited,
  onPress,
}: {
  lesson: Lesson;
  favorited: boolean;
  onPress: () => void;
}) {
  const t = useT();
  const duration = formatDuration(lesson.durationSeconds);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        { paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontWeight: fontWeight.heading, fontSize: fontSize.body, color: theme.textPrimary, flex: 1 }}>
          {lesson.title}
        </Text>
        {favorited ? (
          <Text style={{ color: theme.textAccent, fontSize: fontSize.body, marginLeft: spacing[2] }} accessibilityLabel={t('curriculum.lesson.favoritedLabel')}>
            ★
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing[1], flexWrap: 'wrap' }}>
        {lesson.free ? <Chip label={t('curriculum.lesson.free')} tone="success" /> : null}
        <Chip label={lesson.format === 'LIVE' ? t('curriculum.lesson.live') : t('curriculum.lesson.prerecorded')} tone="accent" />
        {duration ? <Chip label={duration} tone="muted" /> : null}
      </View>

      {lesson.locked ? (
        <Muted>{t('curriculum.lesson.locked')}</Muted>
      ) : lesson.description ? (
        <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }} numberOfLines={3}>
          {lesson.description}
        </Text>
      ) : null}
    </Pressable>
  );
}
