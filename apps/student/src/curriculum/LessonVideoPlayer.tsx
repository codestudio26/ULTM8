import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import type { Lesson } from './curriculumQueries';
import { useT } from '../i18n/I18nProvider';

const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>
);

/**
 * Cloudflare Stream playback URL (Decision 101/227/254) — option (a) from
 * this function's own earlier draft shipped: `LessonResponseDto` now carries
 * a real, server-computed `playbackUrl` (CurriculumService.
 * shapeLessonResponse calls CloudflareStreamService.getPublicPlaybackUrl
 * itself, null unless captionStatus is READY), so this client never needs
 * `CLOUDFLARE_STREAM_ACCOUNT_ID` or any vendor-specific URL-building logic
 * of its own. Still genuinely unverified against a real Cloudflare Stream
 * account — see that service method's own header comment.
 */
export function getLessonPlaybackUrl(lesson: Lesson): string {
  return lesson.playbackUrl ?? '';
}

function RealVideoPlayer({
  videoUrl,
  onProgress,
  onCompleted,
}: {
  videoUrl: string;
  onProgress: (seconds: number) => void;
  onCompleted: () => void;
}) {
  // `setup` runs once, right after the player is created — the right place to set
  // `timeUpdateEventInterval`, which defaults to 0 (the `timeUpdate` event never
  // fires at all) per expo-video's own VideoPlayer.types.d.ts. 1 second is plenty
  // for LessonDetailScreen's own ~10-second save-throttle to work from; it isn't
  // itself the throttle.
  const player = useVideoPlayer(videoUrl, (p) => {
    p.timeUpdateEventInterval = 1;
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    onProgress(currentTime);
  });
  useEventListener(player, 'playToEnd', () => {
    onCompleted();
  });

  // Caption tracks (`captionTrackRef`) are deliberately NOT wired into the player
  // here. expo-video surfaces subtitle tracks the player finds embedded in the
  // source itself (`player.availableSubtitleTracks`/`subtitleTrack`), not as a
  // separate track-URL prop — wiring this up for real means first confirming
  // CloudflareStreamService actually muxes the AWS Transcribe output into the HLS
  // manifest's own subtitle group, which is a real backend investigation, not a
  // one-line prop here. Skipped per this slice's explicit scope decision
  // (prioritize the player working at all over caption-track plumbing); the
  // native player's own built-in caption UI (if any) still applies to whatever
  // tracks the manifest exposes on its own.
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
}

/** The video section of LessonDetailScreen. Caller (LessonDetailScreen) already
 * gates its whole video+description block on `!lesson.locked`, but this stays
 * defensive too — mirrors LessonRow's own "locked hides description" rule, and a
 * locked Lesson's write/read endpoints (favorite, watch-progress, comments) all
 * 403 server-side regardless, so nothing here should ever try to play one. */
export function LessonVideoPlayer({
  lesson,
  onProgress,
  onCompleted,
}: {
  lesson: Lesson;
  onProgress: (seconds: number) => void;
  onCompleted: () => void;
}) {
  const t = useT();
  if (lesson.locked || !lesson.videoRef) return null; // most Lessons have no video yet — PENDING is the common case

  if (lesson.captionStatus === 'PENDING') return null; // nothing to show at all, per this slice's own task description
  if (lesson.captionStatus === 'PROCESSING') {
    return (
      <View style={styles.notice}>
        <Muted>{t('curriculum.videoPlayer.processing')}</Muted>
      </View>
    );
  }
  if (lesson.captionStatus === 'FAILED') {
    return (
      <View style={styles.notice}>
        <Muted>{t('curriculum.videoPlayer.failed')}</Muted>
      </View>
    );
  }

  // captionStatus === 'READY'
  const videoUrl = getLessonPlaybackUrl(lesson);
  if (!videoUrl) {
    return (
      <View style={styles.notice}>
        <Muted>{t('curriculum.videoPlayer.playbackUrlMissing')}</Muted>
      </View>
    );
  }

  return <RealVideoPlayer videoUrl={videoUrl} onProgress={onProgress} onCompleted={onCompleted} />;
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: theme.surface1,
    borderRadius: radius.input,
    padding: spacing[3],
    marginVertical: spacing[2],
  },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: theme.border,
    borderRadius: radius.input,
    marginVertical: spacing[2],
  },
});
