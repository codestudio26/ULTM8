import { ApiProperty } from '@nestjs/swagger';

const OBJECT = { type: 'object', additionalProperties: true } as const;
const LIST = { type: 'array', items: { type: 'object', additionalProperties: true } } as const;

/**
 * GET /schools/{id}/students/{studentId}/data-export (Decision 432 item 10):
 * what this School holds about one member, downloaded as a JSON file. The
 * portal saves it as is, so its sections are left open here.
 */
export class MemberDataExportResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  exportedAt!: string;

  @ApiProperty({ ...OBJECT, nullable: true })
  profile!: Record<string, unknown> | null;

  @ApiProperty(LIST)
  enrolment!: Record<string, unknown>[];

  @ApiProperty({ type: String, nullable: true })
  joinedOn!: string | null;

  @ApiProperty({ type: String, nullable: true })
  homeBranchName!: string | null;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiProperty(LIST)
  customFields!: Record<string, unknown>[];

  @ApiProperty({ type: String, nullable: true })
  customStatus!: string | null;

  @ApiProperty(LIST)
  guardians!: Record<string, unknown>[];

  @ApiProperty(LIST)
  notes!: Record<string, unknown>[];

  @ApiProperty({ ...OBJECT, nullable: true })
  medicalInfo!: Record<string, unknown> | null;

  @ApiProperty(LIST)
  bookings!: Record<string, unknown>[];

  @ApiProperty(LIST)
  memberships!: Record<string, unknown>[];

  @ApiProperty(LIST)
  payments!: Record<string, unknown>[];

  @ApiProperty(LIST)
  waiverSignatures!: Record<string, unknown>[];

  @ApiProperty(LIST)
  belts!: Record<string, unknown>[];
}
