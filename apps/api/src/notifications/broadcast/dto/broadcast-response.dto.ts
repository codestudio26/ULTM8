import { ApiProperty } from '@nestjs/swagger';
import { BroadcastAudienceDto } from './broadcast-notification.dto';

/**
 * There is no stored `Broadcast` entity (not in schema.prisma, not asked for
 * by the approved scope — a broadcast's only durable trace is the
 * Notification rows it fans out, exactly like every other
 * notification-fanout trigger) — this is this endpoint's own synthesized
 * response, not a serialized row.
 */
export class BroadcastResponseDto {
  @ApiProperty({ description: 'Correlates every Notification this call fanned out — used as the shared prefix of each one\'s notificationId/jobId.' })
  broadcastId!: string;

  @ApiProperty({ enum: BroadcastAudienceDto })
  audience!: BroadcastAudienceDto;

  @ApiProperty({ description: 'How many distinct Students this broadcast was enqueued for.' })
  recipientCount!: number;
}
