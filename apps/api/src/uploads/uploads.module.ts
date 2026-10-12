import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Real photo uploads, product-owner-approved (see CHANGELOG.md "Unreleased"
 * and R2ClientService's own header comment "SECOND access path" note). Every
 * photo/logo/banner field app-wide — Instructor.photoUrl, User.profilePhotoUrl,
 * Branch.logoUrl/bannerUrl, Franchise.logoUrl/bannerUrl, Class.bannerUrl — was a
 * plain pasted-URL text field with no real upload pipeline; this module is the
 * ONE new backend piece that fixes that for all five entities at once:
 * `POST /uploads/public-photo-url`, a presigned PUT against R2's own PUBLIC
 * bucket (separate from the existing private signature/certification bucket —
 * never weakens that bucket's access model) plus the resulting permanent public
 * URL. The frontend forms themselves still PATCH/POST each entity's own
 * existing update endpoint with the returned URL — this module only mints the
 * upload URL, it does not touch Instructor/User/Branch/Franchise/Class rows at
 * all.
 *
 * Imports TenantsModule for SchoolsService (existence checks) and
 * TenantAuthorizationService (every one of this module's own authorization
 * checks delegates to it — School Owner for Instructor/Branch/Class, Franchise
 * Owner for Franchise, Staff-at-School for the on-behalf-of-a-Student USER
 * case). Registers its own independent R2ClientService provider rather than
 * importing WaiversModule/InstructorsModule for theirs — same "duplicate the
 * registration, not the dependency edge" convention those two modules already
 * established for this exact stateless/config-only service.
 */
@Module({
  imports: [TenantsModule],
  controllers: [UploadsController],
  providers: [UploadsService, R2ClientService],
})
export class UploadsModule {}
