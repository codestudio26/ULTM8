import { ApiProperty } from '@nestjs/swagger';

export class DeletionChildDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;
}

export class DeletionKeptChildDto extends DeletionChildDto {
  @ApiProperty({
    enum: ['OTHER_PARENT', 'OWN_LOGIN'],
    description: 'Why the child stays: another active parent is linked, or the child has a login of their own. Only this parent\'s link ends.',
  })
  reason!: 'OTHER_PARENT' | 'OWN_LOGIN';
}

export class DeletionBlockDto {
  @ApiProperty({ enum: ['SCHOOL', 'FRANCHISE'] })
  kind!: 'SCHOOL' | 'FRANCHISE';

  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class AccountDeletionStateDto {
  @ApiProperty({ description: 'True once deletion has been asked for and not cancelled.' })
  pending!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  requestedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When the account is anonymised for good, unless the member signs in again before then.' })
  dueAt!: Date | null;

  @ApiProperty({ description: 'Days between asking and the deletion becoming final.' })
  graceDays!: number;

  @ApiProperty({
    type: [DeletionBlockDto],
    description: 'Open Schools and Franchises this member is the main owner of. While any is listed, deletion is refused (MAIN_OWNER_MUST_HAND_OVER).',
  })
  blockedBy!: DeletionBlockDto[];

  @ApiProperty({ type: [DeletionChildDto], description: 'Children deleted with this account (no other active parent and no login of their own).' })
  childrenDeleted!: DeletionChildDto[];

  @ApiProperty({ type: [DeletionKeptChildDto], description: 'Children who keep their account; only this parent\'s link to them ends.' })
  childrenKept!: DeletionKeptChildDto[];
}
