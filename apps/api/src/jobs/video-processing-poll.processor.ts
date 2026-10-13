import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { NotFoundException as TranscribeNotFoundException } from '@aws-sdk/client-transcribe';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { CloudflareStreamService } from '../common/video/cloudflare-stream.service';
import { TranscribeService } from '../common/video/transcribe.service';
import { VIDEO_PROCESSING_POLL_QUEUE } from './queue.constants';

/** Every 5 minutes — much tighter than the daily sweeps elsewhere in this
 * directory (entity-offboarding-purge, tenant-lifecycle-purge): those poll a
 * date-granular `purgeAt` (90 days out), this one polls two external
 * vendors' own async processing, which can complete in minutes. A cron
 * pattern (not a fixed `repeat.every` interval) to match every other
 * scheduler in this directory's own established style. */
const CRON_EVERY_5_MINUTES = '*/5 * * * *';
const REPEATABLE_JOB_ID = 'video-processing-poll-sweep';

/**
 * GENUINELY NEW SHAPE IN THIS CODEBASE — stated explicitly rather than
 * presented as an established convention: every other scheduled sweep in
 * this directory (entity-offboarding-purge, tenant-lifecycle-purge,
 * membership-expiry-sweep, ...) resolves its own state in a single pass —
 * find rows past some stored timestamp, act on them, done. This one instead
 * drives a Lesson through a multi-step state machine, polling two
 * independent, asynchronous, third-party vendor pipelines (Cloudflare
 * Stream's own video transcoding, then AWS Transcribe's own speech-to-text
 * job) that this codebase has no webhook receiver for (Decision 101 picked
 * both vendors; neither integration ships a push-notification path in this
 * phase) — polling is the only option, and a single sweep can span many
 * cycles for one Lesson before it resolves.
 *
 * The state machine, keyed on `Lesson.captionStatus` (an enum that predates
 * this pipeline — see CurriculumService.requestVideoUploadUrl's own header
 * comment for the full account of why its 4 states are reused this way
 * rather than adding new ones):
 *
 *   PENDING    — no video uploaded yet. Not touched by this sweep at all —
 *                only PROCESSING rows are ever selected below.
 *   PROCESSING — set the instant an upload URL is issued
 *                (requestVideoUploadUrl). Every cycle, for each such Lesson:
 *     1. Ask Cloudflare Stream if the video itself has finished transcoding
 *        (`isVideoReady`). Not yet → skip, try again next cycle.
 *     2. Once ready, ask AWS Transcribe for a completed subtitle URL
 *        (`getCompletedSubtitleUrl`, keyed by this Lesson's own id as the
 *        Transcribe job name — TranscribeService's own established
 *        convention). Three distinct outcomes:
 *          a. It throws AWS SDK's own `NotFoundException` — the
 *             transcription job was never started (this is the FIRST cycle
 *             the video is ready, so nothing has called
 *             `startTranscriptionJob` yet). Start it now, using Cloudflare's
 *             own public playback URL as Transcribe's media source, and
 *             check again next cycle. Caught and handled by this EXACT
 *             exception type, imported directly from `@aws-sdk/
 *             client-transcribe` — not a generic catch — specifically so a
 *             job that hasn't started yet is never confused with one that
 *             genuinely failed (see below).
 *          b. It returns `null` — Transcribe is still working (QUEUED/
 *             IN_PROGRESS). Skip, try again next cycle.
 *          c. It returns a URL — both stages are done. Write
 *             LessonContent.captionTrackRef and flip Lesson.captionStatus to
 *             READY. This Lesson leaves the PROCESSING set and this sweep
 *             never looks at it again.
 *   READY / FAILED — terminal. Not touched by this sweep.
 *
 * ANY exception out of the per-Lesson work above OTHER than the
 * not-started-yet NotFoundException (a genuinely FAILED Transcribe job,
 * TranscribeService's own "completed but no subtitle file" defensive throw,
 * a Cloudflare Stream API error, ...) is caught per-Lesson — never allowed
 * to throw out of the sweep's own loop and abort every other Lesson's check
 * — and flips captionStatus to FAILED. Same per-row resilience principle
 * EntityOffboardingPurgeProcessor's own sweepSimple/sweepRanks already
 * demonstrate (confirmed by reading that file before copying the shape
 * here, not assumed).
 *
 * Runs via PrismaJobsService (`ultm8_jobs`) — a genuine cross-tenant sweep
 * with no single caller, same reasoning as every other scheduled job in this
 * codebase.
 */
@Injectable()
export class VideoProcessingPollScheduler implements OnModuleInit {
  private readonly logger = new Logger(VideoProcessingPollScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(VIDEO_PROCESSING_POLL_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...VideoProcessingPollScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_EVERY_5_MINUTES }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable video-processing-poll job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable video-processing-poll job after all retries — ' +
        'Lessons stuck in captionStatus PROCESSING will never advance to READY/FAILED until this succeeds.',
    );
  }
}

type PolledLesson = { id: string; content: { videoRef: string | null; captionTrackRef: string | null } | null };

@Processor(VIDEO_PROCESSING_POLL_QUEUE)
export class VideoProcessingPollProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingPollProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly cloudflareStream: CloudflareStreamService,
    private readonly transcribe: TranscribeService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const lessons = await this.prismaJobs.lesson.findMany({
      where: { captionStatus: 'PROCESSING' },
      select: { id: true, content: { select: { videoRef: true, captionTrackRef: true } } },
    });

    let readyCount = 0;
    let stillWaiting = 0;
    let failedCount = 0;

    // Sequential, not Promise.all — avoids hammering the two external vendor
    // APIs concurrently, same sequential-sweep style as
    // EntityOffboardingPurgeProcessor.process() above.
    for (const lesson of lessons) {
      try {
        const outcome = await this.pollOneLesson(lesson);
        if (outcome === 'ready') readyCount += 1;
        else stillWaiting += 1;
      } catch (err) {
        failedCount += 1;
        this.logger.error(`video-processing-poll: lesson ${lesson.id} failed — marking captionStatus FAILED.`, err as Error);
        await this.prismaJobs.lesson.update({ where: { id: lesson.id }, data: { captionStatus: 'FAILED' } });
      }
    }

    this.logger.log(
      `video-processing-poll: ${readyCount} lesson(s) now READY, ${stillWaiting} still processing, ${failedCount} marked FAILED.`,
    );
  }

  /** Returns 'ready' once this Lesson's video+captions are both done and
   * captionStatus has been flipped to READY; 'waiting' for every other
   * non-error outcome (video not ready yet, transcription job just started,
   * transcription still in progress) — this sweep will check again next
   * cycle. Throws (other than the handled not-started-yet case) to signal a
   * genuine failure to the caller's per-lesson catch above. */
  private async pollOneLesson(lesson: PolledLesson): Promise<'ready' | 'waiting'> {
    const videoRef = lesson.content?.videoRef;
    if (!videoRef) {
      // Defensive — captionStatus PROCESSING is only ever set alongside a
      // videoRef (requestVideoUploadUrl), so this shouldn't happen.
      this.logger.warn(`video-processing-poll: lesson ${lesson.id} is PROCESSING but has no videoRef — skipping.`);
      return 'waiting';
    }

    const videoReady = await this.cloudflareStream.isVideoReady(videoRef);
    if (!videoReady) {
      this.logger.debug(`video-processing-poll: lesson ${lesson.id} video is still transcoding — will check again next cycle.`);
      return 'waiting';
    }

    let subtitleUrl: string | null;
    try {
      subtitleUrl = await this.transcribe.getCompletedSubtitleUrl(lesson.id);
    } catch (err) {
      if (err instanceof TranscribeNotFoundException) {
        // The video just became ready and no transcription job exists yet
        // for it — start one now, using Cloudflare's own public playback
        // URL as Transcribe's media source.
        await this.transcribe.startTranscriptionJob(lesson.id, this.cloudflareStream.getPublicPlaybackUrl(videoRef));
        this.logger.log(`video-processing-poll: started transcription job for lesson ${lesson.id}.`);
        return 'waiting';
      }
      // A genuinely failed Transcribe job, or any other unexpected error —
      // rethrown for the caller's per-lesson catch to mark FAILED.
      throw err;
    }

    if (subtitleUrl === null) {
      this.logger.debug(`video-processing-poll: lesson ${lesson.id} transcription is still in progress.`);
      return 'waiting';
    }

    await this.prismaJobs.lessonContent.update({ where: { lessonId: lesson.id }, data: { captionTrackRef: subtitleUrl } });
    await this.prismaJobs.lesson.update({ where: { id: lesson.id }, data: { captionStatus: 'READY' } });
    this.logger.log(`video-processing-poll: lesson ${lesson.id} is now READY (video playable, captions attached).`);
    return 'ready';
  }
}
