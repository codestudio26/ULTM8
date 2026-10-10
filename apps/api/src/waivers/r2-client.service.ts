import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Thin wrapper around Cloudflare R2 (S3-compatible object storage) — the confirmed
 * object-storage vendor, Spec 55 §11.3 ("Cloudflare R2... paired with Cloudflare
 * Images as a companion decision for on-the-fly resizing and thumbnailing... Signed-
 * waiver and invoice PDFs are served from R2 directly, no transformation needed").
 * Same "warn on missing config, don't throw at construction, fail on first actual
 * use" convention StripeClientService/TwilioVerifyService/CognitoTokenVerifierService
 * already established for every other unconfigured external dependency here.
 *
 * FIRST use of R2 anywhere in this codebase (drawn-signature-capture images for
 * WaiverSignature, Decision 74/78 — see that model's own schema comment and
 * SignWaiverDto's own header comment for the full history). School/Franchise/
 * Branch/Class logoUrl/bannerUrl fields are NOT wired to this — they stay
 * plain pasted-URL fields (verified against every one of those DTOs before writing
 * this comment: `@IsUrl() @MaxLength(2048)`, no upload path exists for them) — this
 * service exists narrowly for waiver signature images, not as a general asset
 * pipeline other modules should assume is already wired up for their own fields.
 *
 * Lives inside src/waivers/, not src/common/ — same "wait for a real second caller
 * before generalizing" discipline StripeClientService's own header comment already
 * documents for its own scopedClient() method. If a second module genuinely needs
 * R2 later (e.g. School logo uploads), extract then, against that real caller, not
 * speculatively now.
 *
 * Bucket/object access is deliberately PRIVATE, not R2's public-bucket-URL feature:
 * a signature image is closer to the "legal record" category Spec 55 §11.3 already
 * puts waiver/invoice PDFs in than to a resizable public gallery photo, and the
 * spec's own §12.2 leaves data-residency/GDPR/LGPD compliance for R2-stored assets
 * genuinely open platform-wide — not something this slice resolves by guessing.
 * Given that, EVERY access here — upload and read alike — goes through a
 * short-lived presigned URL rather than a permanently public one, the safer
 * default (same "pick the safer default and flag it for Architect confirmation
 * rather than silently choosing the broader shape" reasoning WaiverSignature's own
 * RLS-policy comment already applies to this exact model). Requires the bucket
 * itself to be created WITHOUT public access enabled — see .env.example's own
 * comment; this codebase has no AWS/Cloudflare credentials to provision the bucket
 * itself, same standing gap as Cognito's User Pool.
 */
@Injectable()
export class R2ClientService {
  private readonly logger = new Logger(R2ClientService.name);
  private readonly client: S3Client | null;
  private readonly bucketName: string | undefined;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucketName = process.env.R2_BUCKET_NAME;
    if (!accountId || !accessKeyId || !secretAccessKey || !this.bucketName) {
      this.logger.warn(
        'R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME are not all set — object-storage uploads will fail until they are.',
      );
      this.client = null;
      return;
    }
    // region 'auto' is R2's own documented value for the S3-compatible endpoint —
    // R2 has no AWS-style regions, and Cloudflare's own docs specify this literal.
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /** A presigned PUT URL for `key` — the caller uploads directly to R2 from the
   * browser, so the image's bytes never pass through apps/api at all (no memory/
   * bandwidth cost on this backend for what could be a large canvas capture).
   * `contentType` is embedded in the signature itself — R2 rejects an upload whose
   * actual Content-Type header doesn't match what was signed, so a caller can't
   * silently upload something other than what they requested a URL for. Expires in
   * 5 minutes — long enough for a real upload immediately after requesting the URL,
   * short enough that a leaked URL is useless soon after. */
  async getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    const client = this.assertConfigured();
    const command = new PutObjectCommand({ Bucket: this.bucketName, Key: key, ContentType: contentType });
    return getSignedUrl(client, command, { expiresIn: 300 });
  }

  /** A presigned GET URL for `key` — generated fresh on every read (a pure local
   * HMAC computation, no network round-trip to R2, so this is cheap even across a
   * paginated list of many signatures) rather than storing or returning a
   * permanently public URL. Expires in 15 minutes — long enough to actually view
   * the image once requested, short enough that a URL embedded in a client-side
   * response doesn't stay valid indefinitely if it leaks. */
  async getPresignedDownloadUrl(key: string): Promise<string> {
    const client = this.assertConfigured();
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(client, command, { expiresIn: 900 });
  }

  /**
   * FOUND ON REVIEW, before this ever shipped: sign() originally accepted any
   * caller-supplied signatureImageKey that merely matched the expected PREFIX
   * (schoolId/waiverId/studentId), with no check that an object was ever
   * actually uploaded there — a caller could fabricate a plausible-looking key
   * under their own prefix, skip the upload entirely, and have "drawn-signature
   * captured" recorded on what Spec 55 §11.3/Decision 74/78 already treat as a
   * legal record. This closes that gap: sign() now calls this before accepting
   * a signatureImageKey. Requires a real network round-trip to R2 (unlike
   * getPresignedUploadUrl/getPresignedDownloadUrl above, which never leave this
   * process) — e2e coverage substitutes a stub for exactly this method via
   * NestJS's overrideProvider, the same pattern platform-admin-auth.e2e-spec.ts
   * already established for CognitoTokenVerifierService.verify(), not a real R2
   * round-trip in CI.
   */
  async objectExists(key: string): Promise<boolean> {
    const client = this.assertConfigured();
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (err) {
      // AWS SDK v3 names this error 'NotFound' for a genuine 404 — anything else
      // (network failure, credential/permission error, R2 outage) is a real
      // infrastructure problem, not "the object doesn't exist," and is rethrown
      // rather than silently treated as either answer.
      if (err instanceof Error && err.name === 'NotFound') {
        return false;
      }
      throw err;
    }
  }

  private assertConfigured(): S3Client {
    if (!this.client) {
      throw new Error(
        'R2ClientService is not configured — set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME',
      );
    }
    return this.client;
  }
}
