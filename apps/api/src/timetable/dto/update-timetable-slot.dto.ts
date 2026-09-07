import { PartialType } from '@nestjs/swagger';
import { CreateTimetableSlotDto } from './create-timetable-slot.dto';

export class UpdateTimetableSlotDto extends PartialType(CreateTimetableSlotDto) {}
