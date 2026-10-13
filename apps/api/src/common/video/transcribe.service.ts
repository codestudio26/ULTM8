import { Injectable, Logger } from '@nestjs/common';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe';

/**
 * AWS Transcribe — captioning/speech-to-text for Lessons (Decision 101;
 * Decision 227/254 — the actual integration). Gated by region only, same
 * "credentials resolve via the SDK's standard provider chain, not an env var
 * here" convention NotificationDeliveryService's SESv2Client already
 * established — not a separate access-key pair, since every other AWS-native
 * service in this codebase (Secrets Manager, Cognito, SES) relies on the same
 * default credential chain (IAM role in deployed ECS, local AWS CLI profile
 * in dev).
 */
@Injectable()
export class TranscribeService {
  private readonly logger = new Logger(TranscribeService.name);
  private readonly client: TranscribeClient | null;

  constructor() {
    const region = process.env.AWS_TRANSCRIBE_REGION;
    if (!region) {
      this.logger.warn('AWS_TRANSCRIBE_REGION is not set — Lesson caption generation will be unavailable until it is.');
      this.client = null;
      return;
    }
    this.client = new TranscribeClient({ region });
  }

  private assertConfigured(): TranscribeClient {
    if (!this.client) {
      throw new Error('TranscribeService is not configured — set AWS_TRANSCRIBE_REGION');
    }
    return this.client;
  }

  /**
   * `jobName` must be globally unique per AWS account — the caller passes a
   * deterministic id (e.g. the Lesson id) so a retried call is idempotent
   * (Transcribe itself rejects a duplicate jobName with a clear error rather
   * than silently starting a second job, which is the behavior this service
   * relies on instead of its own idempotency bookkeeping).
   */
  async startTranscriptionJob(jobName: string, mediaUrl: string): Promise<void> {
    const client = this.assertConfigured();
    await client.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        Media: { MediaFileUri: mediaUrl },
        IdentifyLanguage: true,
        Subtitles: { Formats: ['vtt'] },
      }),
    );
  }

  /**
   * Polled by VideoProcessingPollScheduler — Transcribe is async by nature
   * (start job, then poll `GetTranscriptionJob` or an SNS/webhook neither of
   * which this phase builds; see that scheduler's own header comment).
   * Returns the ready VTT subtitle URL once COMPLETED, or null while still
   * IN_PROGRESS/QUEUED. Throws on FAILED so the caller can mark
   * captionStatus FAILED rather than poll forever.
   */
  async getCompletedSubtitleUrl(jobName: string): Promise<string | null> {
    const client = this.assertConfigured();
    const { TranscriptionJob: job } = await client.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    if (!job) {
      throw new Error(`Transcribe job ${jobName} was not found.`);
    }
    if (job.TranscriptionJobStatus === TranscriptionJobStatus.FAILED) {
      throw new Error(`Transcribe job ${jobName} failed: ${job.FailureReason ?? 'no reason given'}`);
    }
    if (job.TranscriptionJobStatus !== TranscriptionJobStatus.COMPLETED) {
      return null;
    }
    const vttUrl = job.Subtitles?.SubtitleFileUris?.[0];
    if (!vttUrl) {
      throw new Error(`Transcribe job ${jobName} completed but returned no subtitle file.`);
    }
    return vttUrl;
  }
}
