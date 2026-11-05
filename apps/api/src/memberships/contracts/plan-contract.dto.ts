import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const MAX_MINOR_UNITS = 2147483647;

/** Decision 316 item 6: the owner sets, changes or removes a plan's contract. */
export class SetPlanContractDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'The contract text the member signs. null or blank removes the contract from the plan.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Subscription only: the minimum term in whole months (1–120), counted from the membership start.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  minimumTermMonths?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      "Subscription only, with a minimum term: the School's fee, in the plan's currency's minor units, put on the member's balance when they cancel and the membership ends before the minimum term does. The School's tax settings apply.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR_UNITS)
  earlyExitFee?: number | null;
}

export class PlanContractForMemberQueryDto {
  @ApiPropertyOptional({ description: 'A Guardian reading the contract for their linked child.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class PlanContractUploadUrlDto {
  @ApiPropertyOptional({ description: 'A Guardian signing for their linked child.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class SignPlanContractDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  signerFullName!: string;

  @ApiProperty({ description: 'The typed signature.' })
  @IsString()
  @MaxLength(200)
  signatureText!: string;

  @ApiPropertyOptional({ description: 'The drawn signature uploaded with signature-upload-url, if any.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  signatureImageKey?: string;

  @ApiProperty({ description: 'The version of the contract the member read. A newer version is refused (409): read it again.' })
  @IsInt()
  @Min(1)
  contractVersion!: number;

  @ApiPropertyOptional({ description: 'A Guardian signing for their linked child.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class PlanContractDto {
  @ApiProperty() planId!: string;
  @ApiProperty() planTitle!: string;
  @ApiProperty() planType!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: Number, nullable: true }) minimumTermMonths!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: "Minor units, before the School's tax." }) earlyExitFee!: number | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
  @ApiProperty() version!: number;
}

export class PlanContractUploadUrlResponseDto {
  @ApiProperty() uploadUrl!: string;
  @ApiProperty() objectKey!: string;
}

export class PlanContractSignatureDto {
  @ApiProperty() id!: string;
  @ApiProperty() schoolId!: string;
  @ApiProperty() membershipPlanId!: string;
  @ApiProperty() studentId!: string;
  @ApiProperty({ description: 'Who signed: the member, or their Guardian.' }) signedById!: string;
  @ApiProperty() signerFullName!: string;
  @ApiProperty() signatureText!: string;
  @ApiProperty({ type: String, nullable: true, description: 'A short-lived link to the drawn signature.' }) signatureImageUrl!: string | null;
  @ApiProperty() signedAt!: string;
  @ApiProperty({ description: 'The plan as it was named when signed.' }) planTitle!: string;
  @ApiProperty({ description: 'The exact text signed.' }) contractBody!: string;
  @ApiProperty({ type: Number, nullable: true }) minimumTermMonths!: number | null;
  @ApiProperty({ type: Number, nullable: true }) earlyExitFee!: number | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
  @ApiProperty() contractVersion!: number;
  @ApiProperty({ description: 'SHA-256 of the signed text.' }) contractSha256!: string;
  @ApiProperty({ description: 'Whether a purchase used this signature.' }) used!: boolean;
}

export class PlanContractSignatureListDto {
  @ApiProperty({ type: [PlanContractSignatureDto] })
  data!: PlanContractSignatureDto[];
}
