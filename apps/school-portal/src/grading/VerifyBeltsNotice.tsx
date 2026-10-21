import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Modal } from '@ultm8/ui';
import { useGradingSchoolId } from '../auth/AuthContext';
import { clearVerifyNoticeDue, isVerifyNoticeDue } from '../auth/verifyNoticeFlag';
import { usePendingVerifications } from './gradingQueries';
import { useT } from '../i18n/I18nProvider';

/**
 * At login, grading staff see the belts students declared that are waiting
 * to be verified (Decisions 137 item 4, 189): the owner every student's; a
 * coach or Branch Staff member those in the styles they may verify, for
 * their own branches. Shown once per login; nothing shows when the list is
 * empty. Students never see it (the portal is for staff).
 */
export function VerifyBeltsNotice() {
  const schoolId = useGradingSchoolId();
  const t = useT();
  const [due, setDue] = useState(isVerifyNoticeDue);
  const pending = usePendingVerifications(due ? schoolId : null);
  const items = pending.data?.items ?? [];

  const nothingToShow = due && !!schoolId && !pending.isLoading && (!!pending.error || items.length === 0);
  useEffect(() => {
    if (nothingToShow) clearVerifyNoticeDue();
  }, [nothingToShow]);

  if (!due || !schoolId || pending.isLoading || nothingToShow) return null;
  const close = () => {
    clearVerifyNoticeDue();
    setDue(false);
  };
  return (
    <Modal title={t('grading.verifyNotice.title')} onClose={close}>
      <p style={{ marginTop: 0 }}>{t('grading.verifyNotice.body', { count: items.length })}</p>
      <ul aria-label={t('grading.verifyNotice.listAria')} style={{ paddingLeft: 20, maxHeight: 320, overflowY: 'auto' }}>
        {items.map((i) => (
          <li key={i.studentRankId}>
            <Link to={`/students/${i.studentId}`} state={{ name: `${i.firstName} ${i.surname}` }} onClick={close}>
              {i.firstName} {i.surname}
            </Link>{' '}
            — {i.disciplineName}
          </li>
        ))}
      </ul>
      <Button type="button" onClick={close}>
        {t('grading.verifyNotice.later')}
      </Button>
    </Modal>
  );
}
