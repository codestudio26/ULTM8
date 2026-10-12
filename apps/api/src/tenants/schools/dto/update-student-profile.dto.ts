import { UpdateUserDto } from '../../../users/dto/update-user.dto';

/**
 * `PATCH /schools/{schoolId}/students/{studentId}/profile` — v1.2 backend backlog's
 * Student Detail "Edit" gap: a Staff member editing a Student's own profile on their
 * behalf (name, contact info, etc.), which `PATCH /users/me` obviously can't serve
 * since that's self-service only.
 *
 * Deliberately `extends UpdateUserDto` with no changes at all, not a hand-copied field
 * list: the self-service DTO already excludes `email`/`phone` as unique login/OTP
 * identifiers (see its own header comment) — the same reason Staff must not be able to
 * change either on a Student's behalf through this door, since doing so would let
 * Staff silently redirect a Student's login/OTP destination. Every other field
 * `UpdateUserDto` allows a Student to change about themselves is safe for Staff to
 * change on their behalf too; there's no field that's safe for one caller but not the
 * other, so a second, separately-maintained validator set would only drift from this
 * one over time for no benefit. See the PR description for the full scoping call.
 */
export class UpdateStudentProfileDto extends UpdateUserDto {}
