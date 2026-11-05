import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Decision 319 item 4: the School's two schedule-sharing settings. */
export class UpdateScheduleSharingDto {
  @ApiPropertyOptional({ description: 'Staff may add their classes to Google Calendar with a private calendar link.' })
  @IsOptional()
  @IsBoolean()
  staffCalendarFeedsEnabled?: boolean;

  @ApiPropertyOptional({ description: "Show the School's schedule on its own website. Off removes the link." })
  @IsOptional()
  @IsBoolean()
  scheduleEmbedEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Replace the embed link; the old one stops working.' })
  @IsOptional()
  @IsBoolean()
  newEmbedKey?: boolean;
}

export class ScheduleSharingSettingsDto {
  @ApiProperty()
  staffCalendarFeedsEnabled!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'The embed link key, null when the embed is off. Page: GET /schedule-embeds/{key}/page.' })
  scheduleEmbedKey!: string | null;
}

export class MyCalendarFeedLinkDto {
  @ApiProperty({ description: 'The private link token. The calendar is at GET /calendar-feeds/{token}.ics.' })
  token!: string;

  @ApiProperty()
  createdAt!: string;
}

export class MyCalendarFeedDto {
  @ApiProperty({ description: 'Whether the School has calendar links switched on.' })
  enabled!: boolean;

  @ApiPropertyOptional({ type: MyCalendarFeedLinkDto, nullable: true })
  feed!: MyCalendarFeedLinkDto | null;
}

export class DeletedDto {
  @ApiProperty()
  deleted!: boolean;
}

export class ScheduleEmbedClassDto {
  @ApiProperty() title!: string;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty() cancelled!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) branchName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: "The Branch's IANA time zone; else the School's." }) branchTimezone!: string | null;
}

export class ScheduleEmbedDto {
  @ApiProperty() schoolName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) timezone!: string | null;
  @ApiProperty({ enum: ['MONDAY', 'SUNDAY'] }) weekStartsOn!: string;
  @ApiProperty({ type: [ScheduleEmbedClassDto], description: 'The next 28 days, at most 500.' }) classes!: ScheduleEmbedClassDto[];
}
