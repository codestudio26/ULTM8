import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

/** The three audience scopes the product owner approved tonight — all
 * Students at the School (the default a caller gets by choosing ALL), one
 * Branch, or one Class's real roster. No other scope exists — see
 * NotificationBroadcastService.resolveAudience's own header comment for
 * exactly how each is resolved. */
export enum BroadcastAudienceDto {
  ALL = 'ALL',
  BRANCH = 'BRANCH',
  CLASS = 'CLASS',
}

/** Who on one Class's list a CLASS broadcast reaches — ticked by the School
 * Owner (Decision 333, 26 Oct 2026). BOOKED is every Booking that wasn't
 * cancelled (upcoming, attended or no-show), WAITLIST every waitlist place
 * still open (waiting or offered a spot), CANCELLED every cancelled Booking. */
export enum BroadcastClassAudienceDto {
  BOOKED = 'BOOKED',
  WAITLIST = 'WAITLIST',
  CANCELLED = 'CANCELLED',
}

/**
 * POST /schools/{schoolId}/notifications/broadcast body. `branchId`/`classId`
 * are required together with their matching `audience` value and otherwise
 * must be omitted — `ValidateIf` enforces "required when this audience is
 * selected", and NotificationBroadcastService.resolveAudience throws a 400 if
 * the field is missing even past that (defense in depth, same reasoning
 * RoleGrantsService.create() already applies to its own
 * role/branchId-required-together check).
 */
/** A title or message of only spaces would arrive blank on every student's
 * phone; trimming first makes @IsNotEmpty refuse it, as the portal already
 * does on its side. */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class BroadcastNotificationDto {
  @ApiProperty({ description: 'Notification title.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'Notification body.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;

  @ApiProperty({ enum: BroadcastAudienceDto, description: 'Who receives this broadcast.' })
  @IsEnum(BroadcastAudienceDto)
  audience!: BroadcastAudienceDto;

  @ApiPropertyOptional({ description: 'Required when audience is BRANCH — must be a Branch of this School.' })
  @ValidateIf((o: BroadcastNotificationDto) => o.audience === BroadcastAudienceDto.BRANCH)
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Required when audience is CLASS — must be a Class of this School.' })
  @ValidateIf((o: BroadcastNotificationDto) => o.audience === BroadcastAudienceDto.CLASS)
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({
    enum: BroadcastClassAudienceDto,
    isArray: true,
    description: 'Audience CLASS only: which people on the class list receive it. Defaults to BOOKED.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(BroadcastClassAudienceDto, { each: true })
  classAudience?: BroadcastClassAudienceDto[];
}
