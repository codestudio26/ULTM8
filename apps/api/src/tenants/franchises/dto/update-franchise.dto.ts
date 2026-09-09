import { PartialType } from '@nestjs/swagger';
import { CreateFranchiseDto } from './create-franchise.dto';

/** All fields optional for PATCH; same field list/exclusions as CreateFranchiseDto. */
export class UpdateFranchiseDto extends PartialType(CreateFranchiseDto) {}
