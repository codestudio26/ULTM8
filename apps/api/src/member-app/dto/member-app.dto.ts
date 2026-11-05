import { ApiProperty } from '@nestjs/swagger';

export class MemberAppSchoolSwitchesDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty({ description: 'Members may edit their own profile.' })
  editProfile!: boolean;

  @ApiProperty({ description: 'Members (or a Guardian, for a child) may cancel their own Subscription.' })
  cancelMembership!: boolean;

  @ApiProperty({ description: 'A Guardian may add their child to this School.' })
  addFamily!: boolean;

  @ApiProperty({ description: 'Members see their payment history.' })
  paymentHistory!: boolean;

  @ApiProperty({ description: 'The grading countdown shows.' })
  gradingCountdown!: boolean;
}

export class MemberAppSettingsResponseDto {
  @ApiProperty({ description: "The member can't change their own details: a School where they are a Student has \"edit own profile\" off. Language and currency stay theirs." })
  profileLocked!: boolean;

  @ApiProperty({ type: [MemberAppSchoolSwitchesDto], description: 'Each School where the caller, or a child linked to them, is a Student.' })
  schools!: MemberAppSchoolSwitchesDto[];
}
