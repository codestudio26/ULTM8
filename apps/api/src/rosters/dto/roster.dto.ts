import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

/** Longest roster name (not set by a decision). */
export const ROSTER_NAME_MAX = 60;
/** Most students added in one request (not set by a decision). */
export const ROSTER_ADD_MAX = 100;

export class RosterNameDto {
  @ApiProperty({ maxLength: ROSTER_NAME_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A roster name can't be empty." })
  @MaxLength(ROSTER_NAME_MAX, { message: 'A roster name can be at most 60 characters.' })
  name!: string;
}

export class AddRosterStudentsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: ROSTER_ADD_MAX, description: 'Students of this School to add. Ones already on the roster are left as they are.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ROSTER_ADD_MAX)
  @IsUUID('all', { each: true })
  studentIds!: string[];
}

export class RosterDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'How many current students the caller covers are on it.' })
  memberCount!: number;
}

export class RosterListDto {
  @ApiProperty({ type: [RosterDto] })
  items!: RosterDto[];
}

export class RosterStudentsDto {
  @ApiProperty({ type: [String], description: 'The current students on this roster that the caller covers.' })
  studentIds!: string[];
}
