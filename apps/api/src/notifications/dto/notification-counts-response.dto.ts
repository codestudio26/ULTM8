import { ApiProperty } from '@nestjs/swagger';

/**
 * v1.2 backend backlog ("Notifications page" / Decision 204's Concept 5
 * finding) — closes the one real gap that concept's Delivery Ribbon flagged:
 * "Total/Unread are real but page-scoped (no count endpoint exists to total
 * across every page)". This DTO backs that dedicated count, computed
 * server-side over the caller's FULL set of Notification rows, not whatever
 * page of `GET /notifications/me` happens to be loaded client-side.
 */
export class NotificationCountsResponseDto {
  @ApiProperty({ description: "The caller's total Notification count, across every page." })
  total!: number;

  @ApiProperty({
    description:
      "The caller's unread Notification count, across every page. Excludes a Notification that is currently snoozed " +
      '(snoozedUntil in the future) — see NotificationsService.getCountsForCaller\'s own header comment.',
  })
  unread!: number;

  /**
   * v1.2 backend backlog ("Notifications page" — Read within 24h metric,
   * approved by the product owner). Computed over the caller's own, already-
   * READ Notification history only (Notification.readAt IS NOT NULL) — a
   * Notification never read at all has no time-to-read to measure, so it is
   * excluded from both the numerator and the denominator, not counted as a
   * "did not read within 24h" miss. `readWithinOneDayCount`/`readTotalCount`
   * are both included alongside the percentage so a caller with zero read
   * Notifications gets an honest `null` rather than a misleading 0%/100%.
   */
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Percentage (0–100) of the caller's own READ Notifications whose readAt fell within 24h of createdAt. " +
      'Null when the caller has never read a Notification (nothing to compute a rate over).',
  })
  readWithin24hPercent!: number | null;

  @ApiProperty({ description: "How many of the caller's READ Notifications were read within 24h of createdAt." })
  readWithin24hCount!: number;

  @ApiProperty({ description: "How many of the caller's Notifications have ever been read (readAt is set) — the denominator readWithin24hPercent is computed over." })
  readTotalCount!: number;
}
