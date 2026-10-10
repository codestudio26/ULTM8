/** Shape of ULTM8's own Platform Admin JWT payload (see apps/api's own
 * AdminJwtPayload interface — apps/api/src/platform-admin/interfaces/
 * admin-jwt-payload.interface.ts) — decoded client-side for display hints only
 * (e.g. which subRole to show in the nav), same "never trust this for an
 * authorization decision" caveat @ultm8/auth's decodeJwtPayload already
 * documents: apps/api's own guard/services re-check subRole server-side on
 * every request regardless of what this claims. */
export interface AdminJwtClaims {
  sub: string;
  email: string;
  subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN';
}
