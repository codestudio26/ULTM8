import React from 'react';
import { Text, View } from 'react-native';
import { theme, spacing, fontSize, fontWeight, radius } from '../theme/tokens';
import type { Lesson } from './curriculumQueries';

const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>
);

function Chip({ label, tone }: { label: string; tone: 'accent' | 'success' | 'muted' }) {
  const bg = tone === 'success' ? theme.bgSuccess : tone === 'accent' ? theme.border : theme.surface0;
  const fg = tone === 'success' ? theme.textSuccess : tone === 'accent' ? theme.textAccent : theme.textSecondary;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.input, paddingHorizontal: spacing[2], paddingVertical: 2, marginRight: spacing[1] }}>
      <Text style={{ color: fg, fontSize: fontSize.caption, fontWeight: fontWeight.emphasis }}>{label}</Text>
    </View>
  );
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return `${Math.round(seconds / 60)} min`;
}

/** One Lesson on LessonsScreen — title, category context (shown once per group by
 * the parent, not repeated per row), and the metadata every Lesson always carries
 * regardless of lock state (`format`/`durationSeconds`/`free`/`locked`, per
 * `shapeLessonResponse`'s confirmed always-visible field set). A locked Lesson's
 * `description` is already stripped by the backend (null, not just hidden here),
 * so this only ever renders a description when the backend actually sent one.
 *
 * No video playback anywhere in this file — Decision 101 named Cloudflare Stream
 * as the vendor but the integration itself isn't built (`videoRef` is always null
 * until it is, per the DTO's own comment and CurriculumPage's matching subtitle on
 * the Staff side), so there is nothing to play yet. */
export function LessonRow({ lesson }: { lesson: Lesson }) {
  const duration = formatDuration(lesson.durationSeconds);
  return (
    <View style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontWeight: fontWeight.heading, fontSize: fontSize.body, color: theme.textPrimary }}>{lesson.title}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing[1], flexWrap: 'wrap' }}>
        {lesson.free ? <Chip label="Free" tone="success" /> : null}
        <Chip label={lesson.format === 'LIVE' ? 'Live' : 'Prerecorded'} tone="accent" />
        {duration ? <Chip label={duration} tone="muted" /> : null}
      </View>

      {lesson.locked ? (
        <Muted>Locked — not included in your current membership.</Muted>
      ) : lesson.description ? (
        <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }} numberOfLines={3}>
          {lesson.description}
        </Text>
      ) : null}
    </View>
  );
}
