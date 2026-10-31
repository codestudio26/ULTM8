import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomMemberFieldsService } from './custom-member-fields.service';
import {
  CustomFieldFilterQueryDto,
  CustomFieldMatchesDto,
  CustomMemberFieldCreateDto,
  CustomMemberFieldDto,
  CustomMemberFieldListDto,
  CustomMemberFieldOrderDto,
  CustomMemberFieldUpdateDto,
  CustomMemberStatusDto,
  CustomMemberStatusListDto,
  CustomMemberStatusNameDto,
  SetCustomFieldValuesDto,
  SetStudentCustomStatusDto,
  StudentCustomFieldsDto,
  StudentCustomStatusAssignmentListDto,
} from './dto/custom-member-field.dto';

/** Custom member fields and statuses (Decision 315 item 14). Staff only:
 * there is no `me` endpoint, and no member-facing reply carries them. */
@ApiTags('custom-member-fields')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId')
export class CustomMemberFieldsController {
  constructor(private readonly fields: CustomMemberFieldsService) {}

  /** The School's fields, in order. Any staff at the School. */
  @ApiOkResponse({ type: CustomMemberFieldListDto })
  @Get('custom-member-fields')
  listFields(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.fields.listFields(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: CustomMemberFieldDto })
  @Post('custom-member-fields')
  createField(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: CustomMemberFieldCreateDto) {
    return this.fields.createField(user.sub, schoolId, dto);
  }

  /** The new order of every field. */
  @ApiOkResponse({ type: CustomMemberFieldListDto })
  @Put('custom-member-fields/order')
  reorderFields(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: CustomMemberFieldOrderDto) {
    return this.fields.reorderFields(user.sub, schoolId, dto.fieldIds);
  }

  /** The covered students whose value for this field matches (the Students
   * list's Member field filter). */
  @ApiOkResponse({ type: CustomFieldMatchesDto })
  @Get('custom-member-fields/:fieldId/students')
  fieldMatches(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Query() query: CustomFieldFilterQueryDto,
  ) {
    return this.fields.fieldMatches(user.sub, schoolId, fieldId, query.value);
  }

  /** Rename a field, or change a drop-down's choices. */
  @ApiOkResponse({ type: CustomMemberFieldDto })
  @Patch('custom-member-fields/:fieldId')
  updateField(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() dto: CustomMemberFieldUpdateDto,
  ) {
    return this.fields.updateField(user.sub, schoolId, fieldId, dto);
  }

  /** Deletes the field and every student's value for it. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('custom-member-fields/:fieldId')
  async deleteField(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    await this.fields.deleteField(user.sub, schoolId, fieldId);
  }

  /** The School's member statuses. Any staff at the School. */
  @ApiOkResponse({ type: CustomMemberStatusListDto })
  @Get('custom-member-statuses')
  listStatuses(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.fields.listStatuses(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: CustomMemberStatusDto })
  @Post('custom-member-statuses')
  createStatus(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: CustomMemberStatusNameDto) {
    return this.fields.createStatus(user.sub, schoolId, dto.name);
  }

  /** Each covered student's status (the Students list's filter and column). */
  @ApiOkResponse({ type: StudentCustomStatusAssignmentListDto })
  @Get('custom-member-statuses/students')
  statusAssignments(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.fields.statusAssignments(user.sub, schoolId);
  }

  @ApiOkResponse({ type: CustomMemberStatusDto })
  @Patch('custom-member-statuses/:statusId')
  renameStatus(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
    @Body() dto: CustomMemberStatusNameDto,
  ) {
    return this.fields.renameStatus(user.sub, schoolId, statusId, dto.name);
  }

  /** Deletes the status and clears it from every student. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('custom-member-statuses/:statusId')
  async deleteStatus(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('statusId', ParseUUIDPipe) statusId: string) {
    await this.fields.deleteStatus(user.sub, schoolId, statusId);
  }

  /** The student's values for every field, and their member status. */
  @ApiOkResponse({ type: StudentCustomFieldsDto })
  @Get('students/:studentId/custom-fields')
  studentValues(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.fields.studentValues(user.sub, schoolId, studentId);
  }

  @ApiOkResponse({ type: StudentCustomFieldsDto })
  @Put('students/:studentId/custom-fields')
  setStudentValues(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetCustomFieldValuesDto,
  ) {
    return this.fields.setStudentValues(user.sub, schoolId, studentId, dto.values);
  }

  @ApiOkResponse({ type: StudentCustomFieldsDto })
  @Put('students/:studentId/custom-status')
  setStudentStatus(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetStudentCustomStatusDto,
  ) {
    return this.fields.setStudentStatus(user.sub, schoolId, studentId, dto.statusId);
  }
}
