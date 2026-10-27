/**
 * Front-desk calls that wait for their backend
 * (docs/handover/FRONT-DESK-BACKEND-HANDOVER.md). The screens that use them
 * are built and only call them once their switch in frontDeskFeatures.ts is
 * on. Each one says the endpoint it expects; when the endpoint ships,
 * replace the body with the `apiClient` call and turn the switch on.
 */
export class NotBuiltYetError extends Error {
  constructor(what: string) {
    super(`${what} is waiting for its backend (FRONT-DESK-BACKEND-HANDOVER.md).`);
  }
}

export interface SignUpInput {
  kind: 'VISITOR' | 'MEMBER';
  firstName: string;
  surname: string;
  dateOfBirth: string;
  gender: '' | 'FEMALE' | 'MALE';
  phone: string;
  email: string;
  heardFrom: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
}

/** Handover F1: `POST /schools/{schoolId}/front-desk/sessions` { branchId } → a
 * kiosk session token scoped to that School and Branch. */
export async function startKioskSession(_schoolId: string, _branchId: string): Promise<{ sessionToken: string }> {
  throw new NotBuiltYetError('Starting a locked front-desk session');
}

/** Handover F2: `POST /front-desk/sessions/{id}/unlock` { staffCode } → who unlocked it. */
export async function unlockKiosk(_staffCode: string): Promise<{ unlockedBy: string }> {
  throw new NotBuiltYetError('Leaving front-desk mode with a staff code');
}

/** Handover F3: `POST /front-desk/check-in-code` { code } → the student the
 * personal code belongs to, for the welcome card. */
export async function findByPersonalCode(_code: string): Promise<{ studentId: string; firstName: string; surname: string; profilePhotoUrl: string | null }> {
  throw new NotBuiltYetError('Personal check-in codes');
}

/** Handover F5: `POST /schools/{schoolId}/sign-ups` (source FRONT_DESK) → a
 * sign-up waiting for staff approval. */
export async function submitSignUp(_input: SignUpInput): Promise<void> {
  throw new NotBuiltYetError('Sign-ups from the tablet');
}

/** Handover F6: `POST /front-desk/find-me` { name, dateOfBirth } → only
 * whether they're already a member. */
export async function findMe(_name: string, _dateOfBirth: string): Promise<{ alreadyMember: boolean }> {
  throw new NotBuiltYetError('Find me');
}
