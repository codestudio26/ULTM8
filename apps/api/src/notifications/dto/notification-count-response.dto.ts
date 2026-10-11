import { ApiProperty } from '@nestjs/swagger';

/**
 * v1.2 backend backlog's "True total/unread counts" gap under "## Notifications
 * page" — the Delivery Ribbon mockup's Total/Unread tiles only reflected the
 * currently-loaded page; this is the dedicated count the backlog doc itself
 * flagged as missing. Caller-wide, not School-wide — the backlog doc's own
 * text names "or even just caller-wide" as an acceptable scope, and
 * `Notification` has no School/Branch column to scope a wider count by
 * anyway (it's a self-only entity, same as every other read in this
 * controller).
 */
export class NotificationCountResponseDto {
  @ApiProperty({ description: "The caller's total Notification count." })
  total!: number;

  @ApiProperty({ description: "The caller's unread Notification count." })
  unread!: number;
}
