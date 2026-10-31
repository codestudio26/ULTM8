import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
 * FIRST use of R2 was drawn-signature-capture images for WaiverSignature
 * (Decision 74/78 — see that model's own schema comment and SignWaiverDto's
 * own header comment for the full history). School/Franchise/Branch/Class
 * logoUrl/bannerUrl fields are still NOT wired to this — they stay plain
 * pasted-URL fields — this service isn't assumed wired up for every object/
 * image field in the app just because it's shared.
 *
 * Moved to src/common/ (Decision 1/217 — Instructor certification upload) once
 * a real second caller arrived, per this file's own prior "wait for a real
 * second caller before generalizing" note (same discipline
 * StripeClientService's own header comment documents for its own
 * scopedClient() method). Each consuming module (WaiversModule,
 * InstructorsModule) lists this as its own provider rather than importing a
 * shared module for it — same "duplicate the registration, not the dependency
 * edge" convention GuardiansModule's own header comment already established
 * for its independent JwtModule.register() — this is stateless/config-only,
 * so two separate instances cost nothing and keep the module graph flat.
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
 *
 * SECOND access path added for real photo uploads (product-owner-approved —
 * see UploadsModule's own header comment and CHANGELOG.md "Unreleased"): every
 * photo/logo/banner field app-wide (Instructor.photoUrl, User.profilePhotoUrl,
 * Branch/Franchise logoUrl/bannerUrl, Class.bannerUrl) was a plain pasted-URL
 * text field with no real upload pipeline. These are "gallery photo" data, NOT
 * the "legal record" category the private path above exists for (no §12.2
 * data-residency concern was ever raised for them, and the product owner
 * explicitly chose this simpler, PUBLIC-access R2 path over the more complex
 * Cloudflare Images option for v1 — resizing/thumbnailing stays explicitly
 * out of scope, left for Cloudflare Images if ever revisited). Given that, this
 * second path uses R2's own public-bucket mechanism — a SEPARATE bucket
 * (`R2_PUBLIC_BUCKET_NAME`) with Public Access turned on (either R2's own
 * r2.dev subdomain, quick but rate-limited, or a custom domain mapped to the
 * bucket via Cloudflare's CDN — ops' choice; this service only needs the
 * resulting base URL, `R2_PUBLIC_BASE_URL`) — never the original private
 * bucket, whose access model this does not weaken. Reuses the same account
 * credentials above (one R2 account, two buckets) — a public bucket still
 * needs a presigned PUT to accept an upload (R2 does not expose a public,
 * unauthenticated PUT), but a public GET needs no signature at all, so reads
 * are a plain, permanent URL (`getPublicPhotoUrl`) instead of a
 * `getPresignedDownloadUrl`-style short-lived one. See `getPublicPhotoUploadUrl`/
 * `getPublicPhotoUrl`'s own comments.
 */
@Injectable()
export class R2ClientService {
  private readonly logger = new Logger(R2ClientService.name);
  private readonly client: S3Client | null;
  private readonly bucketName: string | undefined;
  private readonly publicBucketName: string | undefined;
  private readonly publicBaseUrl: string | undefined;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucketName = process.env.R2_BUCKET_NAME;
    // Same account, two buckets — the public bucket's own config is read
    // independently of the private one above (see this file's own header
    // comment), so a deployment can configure either, both, or neither.
    this.publicBucketName = process.env.R2_PUBLIC_BUCKET_NAME;
    this.publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
    if (!this.publicBucketName || !this.publicBaseUrl) {
      this.logger.warn(
        'R2_PUBLIC_BUCKET_NAME / R2_PUBLIC_BASE_URL are not both set — public gallery-photo uploads will fail until they are.',
      );
    }
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

  /** Writes `body` to `key` in the private bucket. For uploads that pass
   * through apps/api so their content can be checked first (files on a
   * member, backlog 5.11: type by content and size), rather than going
   * straight from the browser through a presigned PUT. */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const client = this.assertConfigured();
    await client.send(new PutObjectCommand({ Bucket: this.bucketName, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
  }

  /** Reads `key` from the private bucket, or null when there is no such
   * object. For the signed-documents export (Decision 315 item 13), which
   * puts each drawn signature or paper photo inside its document. */
  async getObject(key: string): Promise<Buffer | null> {
    const client = this.assertConfigured();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) return null;
      throw err;
    }
  }

  /** A presigned GET URL for `key` in the private bucket that downloads it as
   * `fileName` (Content-Disposition: attachment) with `contentType`. Expires
   * in 5 minutes: the caller asks for it at the moment of download. */
  async getPresignedFileDownloadUrl(key: string, fileName: string, contentType: string): Promise<string> {
    const client = this.assertConfigured();
    const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      ResponseContentType: contentType,
    });
    return getSignedUrl(client, command, { expiresIn: 300 });
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

  /** Whether R2 credentials are set; callers that only clean up can skip
   * quietly when they are not (local development). */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /** Deletes `key` from the private bucket. Deleting a key that is already
   * gone succeeds, so a retry after a partial failure is safe. Used when a
   * signature reaches the end of its retention (Waivers review: the drawn
   * image used to outlive its record). */
  async deleteObject(key: string): Promise<void> {
    const client = this.assertConfigured();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
  }

  /** A presigned PUT URL for `key` in the PUBLIC bucket (`R2_PUBLIC_BUCKET_NAME`),
   * not the private one `getPresignedUploadUrl` above writes to — see this file's
   * own header comment for why gallery photos get a second bucket rather than
   * reusing the private one. Still needs a real signature: R2 does not expose an
   * unauthenticated public PUT even on a bucket with public GET access enabled,
   * so the upload side works exactly like the private path (same 5-minute expiry,
   * same Content-Type-pinned-into-the-signature behavior) — only the READ side
   * (`getPublicPhotoUrl` below) actually differs. */
  async getPublicPhotoUploadUrl(key: string, contentType: string): Promise<string> {
    const client = this.assertConfigured();
    if (!this.publicBucketName) {
      throw new Error('R2ClientService public bucket is not configured — set R2_PUBLIC_BUCKET_NAME / R2_PUBLIC_BASE_URL');
    }
    const command = new PutObjectCommand({ Bucket: this.publicBucketName, Key: key, ContentType: contentType });
    return getSignedUrl(client, command, { expiresIn: 300 });
  }

  /** The permanent, public URL for `key` once uploaded — a plain string
   * concatenation against `R2_PUBLIC_BASE_URL` (the bucket's r2.dev subdomain or
   * a custom domain mapped to it, ops' choice — see this file's own header
   * comment), not a signed/expiring URL: that's the whole point of the public
   * bucket. No network call, same "cheap, pure local computation" shape
   * `getPresignedDownloadUrl` already has, just without the HMAC step at all. */
  getPublicPhotoUrl(key: string): string {
    if (!this.publicBaseUrl) {
      throw new Error('R2ClientService public bucket is not configured — set R2_PUBLIC_BUCKET_NAME / R2_PUBLIC_BASE_URL');
    }
    return `${this.publicBaseUrl}/${key}`;
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
