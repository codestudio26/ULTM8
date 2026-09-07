import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * `SELECT` shape shared by getMe/updateMe — explicit, not `findUnique({ where })`'s
 * default "every column" — so `passcodeHash` (a bcrypt hash of the login credential)
 * can never leak into a response just because a future field gets added to the User
 * model and this code isn't touched. See UserResponseDto's own header comment.
 */
const SELF_PROFILE_SELECT = {
  id: true,
  email: true,
  phone: true,
  phoneVerifiedAt: true,
  firstName: true,
  surname: true,
  username: true,
  dateOfBirth: true,
  gender: true,
  nationality: true,
  language: true,
  currency: true,
  address: true,
  profilePhotoUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prismaApp: PrismaAppService) {}

  /**
   * `user_self_or_shared_school`'s existing self-visibility clause ("id" = the
   * caller's own current_user_id) already covers this — no new RLS needed. Still
   * routed through `withTenantContext` like every other query in this codebase, not a
   * bypass, so the same connection-level tenant-context machinery applies uniformly.
   */
  async getMe(callerId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.findUnique({ where: { id: callerId }, select: SELF_PROFILE_SELECT }),
    );
    // Should be unreachable in practice — a valid JWT implies the User row exists — but
    // checked explicitly rather than assumed, same defensive convention every other
    // service's findOne uses.
    if (!found) {
      throw new NotFoundException('User not found');
    }
    return found;
  }

  /**
   * Partial update of the caller's own row only — `email`/`phone` are deliberately
   * absent from UpdateUserDto (see its own header comment), and `id` in the WHERE
   * clause is always `callerId`, never a route/body-supplied id, so there's no path
   * for this to touch any row but the caller's own even before RLS's WITH CHECK
   * (`"id" = current_setting('app.current_user_id', true)`) is reached.
   */
  async updateMe(callerId: string, dto: UpdateUserDto) {
    // firstName/surname/dateOfBirth are NOT NULL on User, but `@IsOptional()` on
    // UpdateUserDto only skips validation for `undefined`, not an explicit `null`
    // (class-validator's own IsOptional behavior) — so `{"firstName": null}` would
    // otherwise reach Prisma as a literal null and hit a NOT NULL violation the global
    // exception filter doesn't map to a clean 400 (HttpExceptionFilter only handles
    // P2002/P2025/P2003). dateOfBirth's existing `? ... : undefined` ternary below
    // makes this worse, not better, for that one field: it silently treats an explicit
    // null the same as "omitted" (a no-op) instead of either applying it or rejecting
    // it — the caller gets a 200 that looks like it worked but changed nothing.
    // Rejected explicitly here rather than guessing at a silent reinterpretation.
    if (dto.firstName === null) {
      throw new BadRequestException('firstName cannot be null.');
    }
    if (dto.surname === null) {
      throw new BadRequestException('surname cannot be null.');
    }
    if (dto.dateOfBirth === null) {
      throw new BadRequestException('dateOfBirth cannot be null.');
    }

    // `username` is @unique but nullable — pre-checked explicitly (same convention
    // AuthService.register()/RoleGrantsService.create()/InstructorsService.create()
    // all use) so a duplicate PATCH gets a specific message instead of falling through
    // to HttpExceptionFilter's generic P2002 "A record with this value already
    // exists." Only checked when a real value is supplied — null/undefined never
    // collide with anything.
    if (dto.username) {
      const duplicate = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.user.findFirst({
          where: { username: dto.username, id: { not: callerId } },
          select: { id: true },
        }),
      );
      if (duplicate) {
        throw new ConflictException('This username is already taken.');
      }
    }

    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.update({
        where: { id: callerId },
        data: {
          firstName: dto.firstName,
          surname: dto.surname,
          username: dto.username,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          gender: dto.gender,
          nationality: dto.nationality,
          language: dto.language,
          currency: dto.currency,
          address: dto.address,
          profilePhotoUrl: dto.profilePhotoUrl,
        },
        select: SELF_PROFILE_SELECT,
      }),
    );
  }
}
