import { ApiProperty } from '@nestjs/swagger';

export class BroadcastNotificationResponseDto {
  @ApiProperty({ description: 'Count of distinct active Students the broadcast was enqueued for.' })
  recipientCount!: number;
}
