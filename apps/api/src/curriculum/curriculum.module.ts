import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { CloudflareStreamService } from '../common/video/cloudflare-stream.service';
import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';

/**
 * Phase 44 scoped Lesson CRUD (Staff/Instructor-authored, School-scoped —
 * Decision 104), linked to the existing Skill catalog.
 *
 * Decision 227/254 (this build) extends it with the learner-facing redesign
 * (Favorite, WatchHistory, Playlist/PlaylistItem, Comment) and WIRES — only
 * partially — the video-upload/captioning pipeline Phase 44 deliberately left
 * unbuilt: CloudflareStreamService is now a real provider here
 * (CurriculumService.requestVideoUploadUrl), and VideoProcessingPollScheduler
 * (apps/api/src/jobs/video-processing-poll.processor.ts) polls both it and
 * TranscribeService to completion. TranscribeService itself is NOT added as a
 * provider here — only that scheduler calls it, not CurriculumService. This
 * is UNVERIFIED against either live vendor: no real Cloudflare Stream/AWS
 * Transcribe credentials are provisioned in this working environment (same
 * standing gap as every other unprovisioned vendor here — Stripe/Cognito/R2/
 * Twilio) — the code path exists and type-checks, but nothing has actually
 * exercised it against a real account.
 */
@Module({
  imports: [TenantsModule, GuardiansModule],
  controllers: [CurriculumController],
  providers: [CurriculumService, CloudflareStreamService],
})
export class CurriculumModule {}
