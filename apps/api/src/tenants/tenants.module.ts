import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchoolsController } from './schools/schools.controller';
import { SchoolsService } from './schools/schools.service';
import { BranchesController } from './branches/branches.controller';
import { BranchesService } from './branches/branches.service';
import { RoleGrantsController } from './role-grants/role-grants.controller';
import { RoleGrantsService } from './role-grants/role-grants.service';
import { TenantAuthorizationService } from './tenant-authorization.service';

/**
 * Phase 2 scope only: School CRUD (no delete), Branch CRUD (no delete), RoleGrant
 * assignment/revocation narrowed to the one confirmed authority case (see
 * role-grants/dto/create-role-grant.dto.ts). Franchise CRUD is deliberately excluded
 * this phase (deferred to pair with Franchise-fee billing) — per
 * ultm8-nestjs-module §5's TenantsModule row, which also covers Franchise CRUD and the
 * Franchise Owner School-roster read; neither is built here.
 *
 * Imports AuthModule (which already exports AuthService — no new cross-module wiring
 * beyond this import) so SchoolsService can call AuthService.issueAccessToken() after
 * self-service School creation (ultm8-nestjs-module §7's narrow, approved exception).
 * One-directional: nothing under apps/api/src/auth imports from tenants, confirmed
 * before adding this — no circular import.
 *
 * Exports SchoolsService and TenantAuthorizationService (added in Phase 4) so
 * ClassesModule — a separate module, not folded into this one — can reuse both rather
 * than duplicating the School-existence check and the School-Owner-Manager write gate.
 * Nothing inside TenantsModule's own controllers/services needed this before, which is
 * why no `exports` array existed prior to Phase 4.
 */
@Module({
  imports: [AuthModule],
  controllers: [SchoolsController, BranchesController, RoleGrantsController],
  providers: [SchoolsService, BranchesService, RoleGrantsService, TenantAuthorizationService],
  exports: [SchoolsService, TenantAuthorizationService],
})
export class TenantsModule {}
