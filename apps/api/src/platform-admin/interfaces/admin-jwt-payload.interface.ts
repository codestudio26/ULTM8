import { AdminSubRole } from '@prisma/client';

/**
 * ULTM8's OWN access-token claims for the Platform Admin realm — deliberately not
 * `JwtPayload` (apps/api/src/auth/interfaces/jwt-payload.interface.ts), which carries
 * customer-identity shape (`grants: RoleGrantClaim[]`) that has no meaning here.
 * Platform Admin staff are never rows in the tenant `User` table and this token is
 * never verified by the tenant `JwtStrategy` or vice versa — separate secret, separate
 * `PassportStrategy` name ('platform-admin-jwt'), separate `AuthGuard` subclass. See
 * ultm8-tenant-isolation SKILL.md §3: "a separate JWT issuer and audience... never a
 * `role: admin` column on the same `User` table customers use."
 */
export interface AdminJwtPayload {
  sub: string; // AdminUser.id
  email: string;
  subRole: AdminSubRole;
}
