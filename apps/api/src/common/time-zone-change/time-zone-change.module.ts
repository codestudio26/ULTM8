import { Injectable, Logger, Module } from '@nestjs/common';

/** Where a time zone changed: a Branch's own, or the School's (which reaches the
 * School-wide slots and the Branches with no zone of their own). */
export type TimeZoneChange = { callerId: string; schoolId: string; branchId: string | null };

type Listener = (change: TimeZoneChange) => Promise<void>;

/**
 * Decision 432 item 2: when a Branch's or School's time zone changes, the 4
 * weeks of classes already made from the timetable are re-timed to the new
 * zone. BranchesService and SchoolsService (TenantsModule) say that a zone
 * changed; TimetableService (TimetableModule, which imports TenantsModule)
 * listens. A tiny dependency-free module imported by both sides, so neither
 * module imports the other back (the same shape as WaiverAssignmentModule)
 * rather than this codebase's first forwardRef().
 */
@Injectable()
export class TimeZoneChangeHooks {
  private readonly logger = new Logger(TimeZoneChangeHooks.name);
  private readonly listeners: Listener[] = [];

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Runs every listener after the change was saved. A failure is logged, never
   * thrown: the zone change itself already succeeded. */
  async changed(change: TimeZoneChange): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(change);
      } catch (err) {
        this.logger.error(`Re-timing classes after a time zone change at School ${change.schoolId}${change.branchId ? `, Branch ${change.branchId}` : ''} failed`, err as Error);
      }
    }
  }
}

@Module({
  providers: [TimeZoneChangeHooks],
  exports: [TimeZoneChangeHooks],
})
export class TimeZoneChangeModule {}
