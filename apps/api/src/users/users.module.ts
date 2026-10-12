import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Phase 6 scope only: GET/PATCH /users/me (self-service profile). DELETE /users/me is
 * deliberately deferred — see the Phase 6 kickoff prompt.
 *
 * No cross-module imports beyond PrismaAppService (global, from PrismaModule — not
 * imported explicitly here since @Global() modules don't need it) and JwtAuthGuard
 * (imported directly by the controller, same as every other module) — unlike every
 * other phase so far, this module needs no TenantsModule import: everything it does is
 * scoped to the caller's own User row, with no School/Branch/RoleGrant lookups.
 *
 * v1.2 backend backlog's Student Detail "Edit" gap: exports UsersService so
 * TenantsModule can import it and have SchoolsService call
 * UsersService.updateProfileFor() on a Staff member's behalf, reusing the exact same
 * field-set/validation UpdateUserDto already established rather than duplicating it —
 * still one-directional (UsersModule still imports nothing from tenants).
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
