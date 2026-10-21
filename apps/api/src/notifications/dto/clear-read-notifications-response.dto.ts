import { ApiProperty } from '@nestjs/swagger';

/** Decision 274 — POST /notifications/me/clear-read's response. */
export class ClearReadNotificationsResponseDto {
  @ApiProperty({ description: 'How many read Notifications were cleared (hidden; the records are kept).' })
  cleared!: number;
}
