import React from 'react';
import { Card } from '@ultm8/ui';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

/** Decision 315 item 10: the student's medical information, for the owner
 * and staff the owner let see it. Never cached beyond this page. */
function useStudentMedicalInfo(schoolId: string, studentId: string) {
  return useQuery({
    queryKey: ['studentMedicalInfo', schoolId, studentId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/medical-info', { params: { path: { schoolId, studentId } } })),
    retry: false,
    gcTime: 0,
  });
}

/**
 * Medical information the member (or a child's Guardian) gave at sign-up,
 * with who consented and when. Shown only to School owners and Branch Staff
 * with "See medical information"; the API refuses everyone else, and the
 * card then shows nothing. Once the member (or the Guardian) withdraws
 * consent, or the member leaves the School, it is deleted and the card says
 * there is none (Decision 419 item 1).
 */
export function StudentMedicalInfoCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const query = useStudentMedicalInfo(schoolId, studentId);
  if (query.isPending || query.isError) return null;
  const info = query.data.medicalInfo;
  const date = info ? new Date(info.consentedAt).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const name = info?.consentedByName ?? t('students.medical.formerAccount');
  return (
    <div style={{ marginBottom: 24 }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
          {t('students.medical.title')}
        </h2>
        {info ? (
          <>
            <p data-testid="student-medical-info" style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>
              {info.body}
            </p>
            <p className="ultm8-field__hint" style={{ margin: 0 }}>
              {info.consentedByGuardian ? t('students.medical.consentGuardian', { name, date }) : t('students.medical.consentSelf', { name, date })}
            </p>
          </>
        ) : (
          <p className="ultm8-field__hint" style={{ margin: 0 }}>
            {t('students.medical.empty')}
          </p>
        )}
        <p className="ultm8-field__hint" style={{ margin: '8px 0 0' }}>
          {t('students.medical.privacy')}
        </p>
      </Card>
    </div>
  );
}
