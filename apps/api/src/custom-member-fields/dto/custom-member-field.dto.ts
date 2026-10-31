import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { CustomMemberFieldType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const trimEach = ({ value }: { value: unknown }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v)) : value);

/** Longest field or status name. Decision 315 item 14 sets 50 for statuses;
 * fields use the same (not set by a decision). */
export const CUSTOM_NAME_MAX = 50;
/** Longest drop-down choice (not set by a decision). */
export const CUSTOM_OPTION_MAX = 50;
/** Most choices on one drop-down (not set by a decision). */
export const CUSTOM_OPTIONS_MAX = 50;
/** Longest text value (not set by a decision). */
export const CUSTOM_TEXT_VALUE_MAX = 500;

export class CustomMemberFieldCreateDto {
  @ApiProperty({ maxLength: CUSTOM_NAME_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A name can't be empty." })
  @MaxLength(CUSTOM_NAME_MAX, { message: 'A name can be at most 50 characters.' })
  name!: string;

  @ApiProperty({ enum: CustomMemberFieldType, enumName: 'CustomMemberFieldType' })
  @IsEnum(CustomMemberFieldType)
  type!: CustomMemberFieldType;

  @ApiPropertyOptional({ type: [String], description: "A drop-down's choices, in order. Only for DROPDOWN, which needs at least one." })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(CUSTOM_OPTIONS_MAX, { message: 'A drop-down can have at most 50 choices.' })
  @IsString({ each: true })
  @MinLength(1, { each: true, message: "A choice can't be empty." })
  @MaxLength(CUSTOM_OPTION_MAX, { each: true, message: 'A choice can be at most 50 characters.' })
  options?: string[];
}

/** Rename a field and, for a drop-down, change its choices. The type stays. */
export class CustomMemberFieldUpdateDto {
  @ApiPropertyOptional({ maxLength: CUSTOM_NAME_MAX })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A name can't be empty." })
  @MaxLength(CUSTOM_NAME_MAX, { message: 'A name can be at most 50 characters.' })
  name?: string;

  @ApiPropertyOptional({ type: [String], description: "A drop-down's new choices, in order. Students whose value is no longer a choice lose it." })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(CUSTOM_OPTIONS_MAX, { message: 'A drop-down can have at most 50 choices.' })
  @IsString({ each: true })
  @MinLength(1, { each: true, message: "A choice can't be empty." })
  @MaxLength(CUSTOM_OPTION_MAX, { each: true, message: 'A choice can be at most 50 characters.' })
  options?: string[];
}

export class CustomMemberFieldOrderDto {
  @ApiProperty({ type: [String], description: "Every one of the School's field ids, in the new order." })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  fieldIds!: string[];
}

export class CustomMemberFieldDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: CustomMemberFieldType, enumName: 'CustomMemberFieldType' })
  type!: CustomMemberFieldType;

  @ApiProperty({ type: [String] })
  options!: string[];

  @ApiProperty({ description: 'Order on the student page, from 0.' })
  position!: number;
}

export class CustomMemberFieldListDto {
  @ApiProperty({ type: [CustomMemberFieldDto] })
  items!: CustomMemberFieldDto[];
}

export class CustomMemberStatusNameDto {
  @ApiProperty({ maxLength: CUSTOM_NAME_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A name can't be empty." })
  @MaxLength(CUSTOM_NAME_MAX, { message: 'A name can be at most 50 characters.' })
  name!: string;
}

export class CustomMemberStatusDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'How many students have this status.' })
  studentCount!: number;
}

export class CustomMemberStatusListDto {
  @ApiProperty({ type: [CustomMemberStatusDto] })
  items!: CustomMemberStatusDto[];
}

export class StudentCustomStatusAssignmentDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  statusId!: string;
}

export class StudentCustomStatusAssignmentListDto {
  @ApiProperty({ type: [StudentCustomStatusAssignmentDto], description: 'The students with a status that the caller covers.' })
  items!: StudentCustomStatusAssignmentDto[];
}

export class StudentCustomFieldValueDto extends CustomMemberFieldDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The value as text: a number, YYYY-MM-DD, one of the choices, or "true"/"false". Null when empty.',
  })
  value!: string | null;
}

export class StudentCustomFieldsDto {
  @ApiProperty({ type: [StudentCustomFieldValueDto] })
  fields!: StudentCustomFieldValueDto[];

  @ApiProperty({ type: String, nullable: true, description: "The student's member status at this School, or null." })
  statusId!: string | null;
}

export class SetCustomFieldValueDto {
  @ApiProperty()
  @IsUUID()
  fieldId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Null or empty clears the value.' })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(CUSTOM_TEXT_VALUE_MAX, { message: 'A value can be at most 500 characters.' })
  value!: string | null;
}

export class SetCustomFieldValuesDto {
  @ApiProperty({ type: [SetCustomFieldValueDto], description: 'Only the fields listed change.' })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SetCustomFieldValueDto)
  values!: SetCustomFieldValueDto[];
}

export class SetStudentCustomStatusDto {
  @ApiProperty({ type: String, nullable: true, description: 'A status from the School list, or null for none.' })
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  statusId!: string | null;
}
