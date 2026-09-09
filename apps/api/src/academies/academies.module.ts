import { Module } from '@nestjs/common';
import { AcademiesController } from './academies.controller';
import { AcademiesService } from './academies.service';

/**
 * Phase 14 scope only: read-only mobile-facing discovery. See AcademiesService's
 * own header comment for the full scoping rationale (Decision 94).
 *
 * No TenantsModule import needed — every read here runs through the dedicated
 * `ultm8_discovery` connection (PrismaDiscoveryService, from the global
 * PrismaModule), never a School-Owner-gated write (there are no writes in this
 * module at all) and never a per-caller tenant context (unlike every other
 * module, this one's row visibility isn't RoleGrant-scoped by design).
 */
@Module({
  controllers: [AcademiesController],
  providers: [AcademiesService],
})
export class AcademiesModule {}
