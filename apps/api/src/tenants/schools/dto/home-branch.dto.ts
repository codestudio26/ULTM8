import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** PUT /schools/{id}/students/{studentId}/home-branch (Decisions 148, 168). */
export class SetHomeBranchDto {
  @ApiProperty({ description: 'A branch of this School.' })
  @IsUUID()
  branchId!: string;
}

export class StudentHomeBranchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ type: String, nullable: true })
  assignedById!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
