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

  @ApiProperty({ description: "The caller's unread Notification count, across every page." })
  unread!: number;
}
