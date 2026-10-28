import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** GET /platform-admin/schools/{id}/owners (Decision 370). */
export class SchoolOwnerDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ description: "The School's main owner. Every other owner is a co-owner." })
  mainOwner!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  ownerSince!: string;
}

export class SchoolOwnersResponseDto {
  @ApiProperty({ type: [SchoolOwnerDto], description: 'Main owner first, then co-owners, earliest first.' })
  items!: SchoolOwnerDto[];
}

/** POST /platform-admin/schools/{id}/main-owner (Decision 370). */
export class ChangeSchoolMainOwnerDto {
  @ApiProperty({ description: 'A co-owner of this School, who becomes its main owner.' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ description: "Also end the former main owner's owner role at this School. Default false." })
  @IsOptional()
  @IsBoolean()
  removeFormerMainOwner?: boolean;
}
