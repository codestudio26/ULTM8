import { PartialType } from '@nestjs/swagger';
import { CreateSchoolDto } from './create-school.dto';

/** All fields optional for PATCH; same field list/exclusions as CreateSchoolDto. */
export class UpdateSchoolDto extends PartialType(CreateSchoolDto) {}
