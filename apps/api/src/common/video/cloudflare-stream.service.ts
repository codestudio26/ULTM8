import { Injectable, Logger } from '@nestjs/common';

/**
 * Cloudflare Stream — video hosting/delivery for Lessons (Decision 101: picked
 * for the same read-heavy/egress-heavy public-media access pattern that already
 * justified R2 over S3 for images; Decision 227/254 — the actual integration,
 * folded into the Curriculum learner-facing redesign per Decision 225).
 *
 * Same "warn on missing config, don't throw at construction, fail on first
 * actual use" convention R2ClientService/TwilioVerifyService/
 * CognitoTokenVerifierService already established. No official Cloudflare
 * Stream Node SDK exists — this talks to Cloudflare's REST API directly via
 * the Node 20+ global `fetch`, the same way this codebase avoids adding an
 * HTTP-client dependency it doesn't otherwise need.
 *
 * `videoRef` (stored on LessonContent) is Cloudflare Stream's own video UID —
 * a vendor-agnostic opaque string by the schema's own design (Lesson's header
 * comment), so nothing outside this service needs to know it's a Stream UID
 * specifically.
 */
@Injectable()
export class CloudflareStreamService {
  private readonly logger = new Logger(CloudflareStreamService.name);
  private readonly accountId: string | undefined;
  private readonly apiToken: string | undefined;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID;
    this.apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;

    if (!this.accountId || !this.apiToken) {
      this.logger.warn(
        'CLOUDFLARE_STREAM_ACCOUNT_ID / CLOUDFLARE_STREAM_API_TOKEN are not set — ' +
          'Lesson video upload/playback will fail until they are.',
      );
    }
  }

  /** Whether the account settings are there at all (C4). */
  isConfigured(): boolean {
    return Boolean(this.accountId && this.apiToken);
  }

  private assertConfigured(): { accountId: string; apiToken: string } {
    if (!this.accountId || !this.apiToken) {
      throw new Error(
        'CloudflareStreamService is not configured — set CLOUDFLARE_STREAM_ACCOUNT_ID / CLOUDFLARE_STREAM_API_TOKEN',
      );
    }
    return { accountId: this.accountId, apiToken: this.apiToken };
  }

  /**
   * A one-time "direct creator upload" URL — Cloudflare Stream's own upload
   * mechanism, NOT an S3-style presigned PUT (R2ClientService's pattern isn't
   * reusable here; Stream's API returns both the upload URL and the video's
   * UID up front, before any bytes are sent). The caller PUTs the raw video
   * file straight to the returned `uploadUrl`; `videoRef` (the UID) is stored
   * immediately so the poll scheduler can start checking readiness.
   */
  async createDirectUploadUrl(maxDurationSeconds = 3600): Promise<{ uploadUrl: string; videoRef: string }> {
    const { accountId, apiToken } = this.assertConfigured();
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxDurationSeconds }),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare Stream direct_upload request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { result: { uploadURL: string; uid: string } };
    return { uploadUrl: body.result.uploadURL, videoRef: body.result.uid };
  }

  /**
   * Polled by VideoProcessingPollScheduler, not called inline on upload —
   * Stream's own transcoding is asynchronous and there is no webhook receiver
   * built in this phase (see that scheduler's own header comment for why).
   */
  async isVideoReady(videoRef: string): Promise<boolean> {
    const { accountId, apiToken } = this.assertConfigured();
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoRef}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Cloudflare Stream status request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { result: { readyToStream: boolean } };
    return body.result.readyToStream;
  }

  /**
   * Where a video stands (C5): 'ready'; 'waiting' while it uploads or
   * transcodes; 'failed' when Stream reports an error, or when the one-time
   * upload link expired with no file ever sent — without this a lesson whose
   * upload never arrived stayed PROCESSING forever. Uses Stream's own
   * `status.state` and `uploadExpiry` fields; like the rest of this service,
   * not yet verified against a real account (v1.3, Decision 267).
   */
  async videoState(videoRef: string, now = new Date()): Promise<'ready' | 'waiting' | 'failed'> {
    const { accountId, apiToken } = this.assertConfigured();
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoRef}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Cloudflare Stream status request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { result: { readyToStream: boolean; uploadExpiry?: string | null; status?: { state?: string } } };
    return videoStateOf(body.result, now);
  }

  /**
   * The public HLS manifest URL — Stream's videos are public-by-default once
   * ready (same "public media, no per-request signing" reasoning as R2's own
   * public photo bucket), so this is a plain string build, no network call,
   * same shape as R2ClientService.getPublicPhotoUrl().
   *
   * FLAGGED, NOT VERIFIED: Cloudflare's own docs name a separate per-account
   * "customer code" for this subdomain, which is NOT necessarily the same
   * value as the account id used for API auth above — this implementation
   * assumes they're the same for now, since no real Cloudflare Stream account
   * exists in this environment to confirm against. Re-verify this exact URL
   * shape against a real account before trusting it in production; if the
   * customer code differs, it needs its own env var
   * (e.g. `CLOUDFLARE_STREAM_CUSTOMER_CODE`), not a silent assumption.
   */
  getPublicPlaybackUrl(videoRef: string): string {
    return `https://customer-${this.accountId ?? 'unconfigured'}.cloudflarestream.com/${videoRef}/manifest/video.m3u8`;
  }
}

/** Pure part of videoState(), exported for unit tests. */
export function videoStateOf(
  result: { readyToStream: boolean; uploadExpiry?: string | null; status?: { state?: string } },
  now: Date,
): 'ready' | 'waiting' | 'failed' {
  if (result.readyToStream) return 'ready';
  const state = result.status?.state;
  if (state === 'error') return 'failed';
  if (state === 'pendingupload' && result.uploadExpiry && new Date(result.uploadExpiry) < now) return 'failed';
  return 'waiting';
}
