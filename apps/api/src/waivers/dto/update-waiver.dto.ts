import { PartialType } from '@nestjs/swagger';
import { CreateWaiverDto } from './create-waiver.dto';

export class UpdateWaiverDto extends PartialType(CreateWaiverDto) {}
