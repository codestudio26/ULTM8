-- Decision 235 (POST-SPEC-55-DECISION-LOG.md) — no-camera check-in fallback:
-- a new Student-initiated, standing, camera-free check-in method (typing a
-- 6-digit code derived from the same Class-scoped QR token signing
-- mechanism — QrTokenService, no schema/table change needed for the code
-- itself, stateless by construction). Distinct from the existing Staff-
-- initiated INSTRUCTOR_MANUAL fallback.

-- AlterEnum
ALTER TYPE "CheckInMethod" ADD VALUE 'SELF_SERVICE_CODE';
