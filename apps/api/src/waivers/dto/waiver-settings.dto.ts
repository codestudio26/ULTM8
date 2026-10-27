import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/** A School's Waiver settings (Waivers → Settings; Decision 354). */
export class WaiverSettingsDto {
  @ApiProperty({ description: 'A signature on an archived waiver still counts for classes and plans that need a waiver. Default on.' })
  waiverArchivedSignaturesCount!: boolean;

  @ApiProperty({ type: Number, nullable: true, description: 'Members sign again every this many months. Null (the default): a signature never runs out.' })
  waiverRenewalMonths!: number | null;

  @ApiProperty({ description: 'A waiver a Guardian signed for a child stops counting when the child turns 18, and they sign it themselves. Default on.' })
  waiverMinorsSignAgainAt18!: boolean;

  @ApiProperty({ description: 'The Owner and Managers can record a waiver signed on paper. Default on.' })
  waiverPaperSignaturesAllowed!: boolean;

  @ApiProperty({ description: 'A new member is told which waivers to sign when they join. Default on.' })
  waiverNoticeOnJoin!: boolean;

  @ApiProperty({ type: Number, nullable: true, description: 'Remind members who have not signed every this many days. Null (the default): no repeat reminders.' })
  waiverReminderDays!: number | null;
}

export class UpdateWaiverSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  waiverArchivedSignaturesCount?: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, description: '1 to 120 months, or null for never.' })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(120)
  waiverRenewalMonths?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  waiverMinorsSignAgainAt18?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  waiverPaperSignaturesAllowed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  waiverNoticeOnJoin?: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, description: '1 to 90 days, or null for off.' })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(90)
  waiverReminderDays?: number | null;
}
