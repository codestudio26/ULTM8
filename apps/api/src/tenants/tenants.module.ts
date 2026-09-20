import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { SchoolsController } from './schools/schools.controller';
import { SchoolsService } from './schools/schools.service';
import { BranchesController } from './branches/branches.controller';
import { BranchesService } from './branches/branches.service';
import { RoleGrantsController } from './role-grants/role-grants.controller';
import { RoleGrantsService } from './role-grants/role-grants.service';
import { FranchisesController } from './franchises/franchises.controller';
import { FranchisesService } from './franchises/franchises.service';
import { TenantAuthorizationService } from './tenant-authorization.service';

/**
 * Phase 2 scope: School CRUD (no delete), Branch CRUD (no delete), RoleGrant
 * assignment/revocation narrowed to the one confirmed authority case (see
 * role-grants/dto/create-role-grant.dto.ts).
 *
 * Phase 16 adds Franchise CRUD (no delete) + the Franchise Owner School-roster read —
 * deliberately deferred out of Phase 2 to pair with Franchise-fee billing (see this
 * file's own prior header comment, superseded here); ultm8-nestjs-module §5's
 * TenantsModule row covers both. Franchise creation mirrors School's self-service
 * pattern exactly (Decision 79, extended to Franchise directly with the product
 * owner this phase) — creator becomes FRANCHISE_OWNER atomically, same as School's
 * SCHOOL_OWNER_MANAGER bootstrap. RoleGrant issuance (`role-grants/`) stays
 * unchanged — Decision 80's authority matrix ("Franchise Owner granting anything...
 * is still genuinely unconfirmed and is rejected") is untouched by this phase;
 * FRANCHISE_OWNER is granted only via FranchisesService.create()'s own self-grant,
 * never through CreateRoleGrantDto.
 *
 * Imports AuthModule (which already exports AuthService — no new cross-module wiring
 * beyond this import) so SchoolsService/FranchisesService can call
 * AuthService.issueAccessToken() after self-service creation (ultm8-nestjs-module §7's
 * narrow, approved exception). One-directional: nothing under apps/api/src/auth
 * imports from tenants, confirmed before adding this — no circular import.
 *
 * Imports GuardiansModule (Phase 38) so SchoolsService can call
 * GuardiansService.assertGuardianOfStudent() for Guardian-on-behalf-of School
 * enrollment (join()'s own header comment) — also one-directional, confirmed
 * the same way: GuardiansModule imports nothing from tenants.
 *
 * Exports SchoolsService, FranchisesService, and TenantAuthorizationService so other
 * modules can reuse them rather than duplicating existence/authorization checks —
 * PaymentsModule now uses FranchisesService.findOne() the same way it already used
 * SchoolsService.findOne() (Phase 16 closes the "no FranchisesService.findOne() exists
 * yet" gap PaymentsService.createForFranchise/findForFranchise both flagged in Phase 8).
 */
@Module({
  imports: [AuthModule, GuardiansModule],
  controllers: [SchoolsController, BranchesController, RoleGrantsController, FranchisesController],
  providers: [SchoolsService, BranchesService, RoleGrantsService, FranchisesService, TenantAuthorizationService],
  exports: [SchoolsService, FranchisesService, TenantAuthorizationService],
})
export class TenantsModule {}
