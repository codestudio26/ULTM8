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
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
