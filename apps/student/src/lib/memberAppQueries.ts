import { useQuery } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MemberAppSettings = components['schemas']['MemberAppSettingsResponseDto'];
type Switch = 'editProfile' | 'cancelMembership' | 'addFamily' | 'paymentHistory' | 'gradingCountdown';

/** GET /member-app/me (Decision 318 item 7): what each of the member's Schools
 * (and their children's) lets them do in the app. The app only hides what a
 * School turned off; the API refuses it on its own. */
export function useMemberAppSettings() {
  return useQuery({ queryKey: ['member-app-settings'], queryFn: () => unwrap(apiClient.GET('/v1/member-app/me')) });
}

/** Whether a School allows something. A School not in the list (or the list
 * not loaded yet) keeps the app as it was: on. */
export function schoolAllows(settings: MemberAppSettings | undefined, schoolId: string, which: Switch): boolean {
  const school = settings?.schools.find((s) => s.schoolId === schoolId);
  return school ? school[which] : true;
}

/** Whether "payment history" has anything to show: false only when every one
 * of the member's Schools turned it off. */
export function anySchoolShowsPaymentHistory(settings: MemberAppSettings | undefined): boolean {
  if (!settings || settings.schools.length === 0) return true;
  return settings.schools.some((s) => s.paymentHistory);
}
