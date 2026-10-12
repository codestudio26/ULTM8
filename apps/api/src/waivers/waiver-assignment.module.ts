import { Module } from '@nestjs/common';
import { WaiverAssignmentService } from './waiver-assignment.service';

/**
 * A tiny, dependency-free module for `WaiverAssignmentService` — see that
 * service's own header comment for why this is split out of `WaiversModule`
 * rather than folded into it: `WaiversModule` already imports `TenantsModule`,
 * so `TenantsModule` importing `WaiversModule` back (to let
 * `SchoolsService.join()` call this) would be circular. Importing THIS module
 * from both `WaiversModule` and `TenantsModule` instead is additive and
 * one-directional both ways.
 */
@Module({
  providers: [WaiverAssignmentService],
  exports: [WaiverAssignmentService],
})
export class WaiverAssignmentModule {}
