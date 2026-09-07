import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateInstructorDto } from './create-instructor.dto';

/**
 * `userId` is deliberately excluded, not just made optional — a profile can't be
 * reassigned to a different User via PATCH; nothing in Spec 55 describes a
 * reassignment flow, and silently allowing it would let a School Owner/Manager move
 * one person's bio/photo/specializations onto another person's profile row by
 * accident. If reassignment is ever a real need, it's a deliberate, separate decision
 * to make (flag for Architect review), not a side effect of this DTO's shape.
 */
export class UpdateInstructorDto extends PartialType(OmitType(CreateInstructorDto, ['userId'] as const)) {}
