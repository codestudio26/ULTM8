import { Module } from '@nestjs/common';
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
 */
@Module({
  controllers: [SchoolsController, BranchesController, RoleGrantsController],
  providers: [SchoolsService, BranchesService, RoleGrantsService, TenantAuthorizationService],
})
export class TenantsModule {}
