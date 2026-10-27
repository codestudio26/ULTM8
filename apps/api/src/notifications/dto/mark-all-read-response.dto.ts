import { ApiProperty } from '@nestjs/swagger';

/** Decision 355 — POST /notifications/me/read-all's response. */
export class MarkAllReadResponseDto {
  @ApiProperty({ description: 'How many unread Notifications were marked read.' })
  updated!: number;
}
