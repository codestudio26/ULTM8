import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BroadcastAudienceDto, BroadcastClassAudienceDto } from './broadcast-notification.dto';

/** Decision 363 — one row of the School's sent-broadcast history, a
 * field-for-field match of the NotificationBroadcast Prisma model. The
 * Branch/Class names are copies taken at send time; their ids go to null if
 * that Branch or Class is later purged. */
export class SentBroadcastResponseDto {
  @ApiProperty({ description: 'The broadcastId POST .../broadcast returned.' })
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  sentById!: string;

  @ApiProperty({ description: 'The sender\'s name when it was sent.' })
  sentByName!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ enum: BroadcastAudienceDto })
  audience!: BroadcastAudienceDto;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  classId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  classTitle!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  classStartDate!: string | null;

  @ApiProperty({ enum: BroadcastClassAudienceDto, isArray: true, description: 'CLASS only: who on the class list it went to. Empty otherwise.' })
  classAudience!: BroadcastClassAudienceDto[];

  @ApiProperty({ description: 'How many distinct Students it was queued for.' })
  recipientCount!: number;

  @ApiProperty()
  createdAt!: string;
}

export class SentBroadcastListResponseDto {
  @ApiProperty({ type: [SentBroadcastResponseDto] })
  items!: SentBroadcastResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
