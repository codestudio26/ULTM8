import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useAcademy } from '../academies/academyQueries';
import { MembershipPlanRow } from '../memberships/MembershipPlanRow';
import { useT } from '../i18n/I18nProvider';

/** Decision 428 (Student portal review M4) — GET /classes/{id}/ticket-plans:
 * which plans on sale are this one-off Class's own ticket. `studentId`: a
 * parent asking for their child. */
export function useClassTicketPlans(classId: string, studentId?: string) {
  return useQuery({
    queryKey: ['class-ticket-plans', classId, studentId ?? 'me'],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/classes/{id}/ticket-plans', {
          params: { path: { id: classId }, query: studentId ? { studentId } : {} },
        }),
      ),
  });
}

/** Shown under a one-off Class whose booking was refused with TICKET_REQUIRED:
 * its ticket, ready to buy (the plan itself comes from the School page's plan
 * list), then Book again. With no ticket on sale, says to ask the School. */
export function ClassTicketOffer({ classId, schoolId, studentId }: { classId: string; schoolId: string; studentId?: string }) {
  const t = useT();
  const ticketPlans = useClassTicketPlans(classId, studentId);
  const academy = useAcademy(schoolId);

  if (ticketPlans.isLoading || academy.isLoading) return <ActivityIndicator />;

  const ids = new Set(ticketPlans.data?.planIds ?? []);
  const plans = (academy.data?.membershipPlans ?? []).filter((p) => ids.has(p.id));

  if (plans.length === 0) {
    return <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>{t('bookings.ticket.noneOnSale')}</Text>;
  }
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '600' }}>{t('bookings.ticket.buyFirst')}</Text>
      {plans.map((plan) => (
        <MembershipPlanRow key={plan.id} plan={plan} schoolId={schoolId} forStudentId={studentId} />
      ))}
    </View>
  );
}
