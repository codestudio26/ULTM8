import { ApiProperty } from '@nestjs/swagger';
import { BroadcastAudienceDto } from './broadcast-notification.dto';

/**
 * This endpoint's own synthesized response, not a serialized row. Since
 * Decision 363 each broadcast is also stored as a NotificationBroadcast row
 * (the sent-broadcast history, SentBroadcastResponseDto) whose id is this
 * broadcastId.
 */
export class BroadcastResponseDto {
  @ApiProperty({ description: 'Correlates every Notification this call fanned out — used as the shared prefix of each one\'s notificationId/jobId.' })
  broadcastId!: string;

  @ApiProperty({ enum: BroadcastAudienceDto })
  audience!: BroadcastAudienceDto;

  @ApiProperty({ description: 'How many distinct Students this broadcast was enqueued for.' })
  recipientCount!: number;
}
