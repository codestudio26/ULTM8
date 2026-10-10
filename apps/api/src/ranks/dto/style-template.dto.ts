import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TemplateId, TEMPLATES } from '../templates/ibjjf';

/** Create a style from one of the IBJJF templates (Decisions 131, 182). */
export class CreateStyleFromTemplateDto {
  @ApiProperty({ enum: TEMPLATES.map((t) => t.id) })
  @IsIn(TEMPLATES.map((t) => t.id))
  templateId!: TemplateId;

  @ApiPropertyOptional({ description: "The style's name. Default: the template's name." })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;
}

export class StyleTemplateDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: 'Number of rungs.' })
  rungs!: number;
}

export class StyleTemplateListResponseDto {
  @ApiProperty({ type: [StyleTemplateDto] })
  items!: StyleTemplateDto[];
}
