import { useState } from 'react';
import { Button, Card, ErrorBanner, Modal, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { usePauseSchoolStaff, useSchoolStaff } from './schoolQueries';

type Member = { userId: string; firstName: string; surname: string; email: string; paused: boolean; roles: Array<{ role: string; branchName: string | null }> };

const ROLE_LABELS: Record<string, string> = { INSTRUCTOR: 'Coach', BRANCH_STAFF: 'Branch Staff' };

/**
 * Decision 433 item 6 — ULTM8 support's emergency "pause staff". Only a
 * School's main owner pauses or removes its coaches and Branch Staff; when
 * the main owner is away or has lost their account, support can pause one
 * here. Their coach and Branch Staff roles end now and come back, as they
 * were, when the main owner unpauses them: support can't unpause or remove
 * anyone, and owners are never paused. Reading is open to every tier; the
 * pause is Full Admin only server-side, and a lower tier sees that refusal
 * as an error here. Both are audit-logged.
 */
export function SchoolStaffCard({ schoolId }: { schoolId: string }) {
  const staff = useSchoolStaff(schoolId);
  const pause = usePauseSchoolStaff(schoolId);
  const [target, setTarget] = useState<Member | null>(null);
  const name = (m: Member) => `${m.firstName} ${m.surname}`.trim();
  const roles = (m: Member) => m.roles.map((r) => `${ROLE_LABELS[r.role] ?? r.role}${r.branchName ? ` at ${r.branchName}` : ''}`).join(', ');

  function close() {
    setTarget(null);
    pause.reset();
  }

  return (
    <Card>
      <h2 className="u8a-card__title">Coaches and Branch Staff</h2>
      {staff.isLoading ? <Spinner /> : null}
      {staff.error ? <ErrorBanner message={staff.error instanceof ApiError ? staff.error.message : 'Could not load the staff.'} /> : null}
      {staff.data && staff.data.items.length === 0 ? <p>This School has no coaches or Branch Staff.</p> : null}
      {staff.data && staff.data.items.length > 0 ? (
        <ul className="u8a-rows">
          {staff.data.items.map((m) => (
            <li key={m.userId} className="u8a-row">
              <span className="u8a-row__who">
                <span className="u8a-row__name">{name(m)}</span>
                <span className="u8a-small">{m.email}</span>
              </span>
              <span className="u8a-row__meta">
                <span className="u8a-small">{roles(m)}</span>
              </span>
              {m.paused ? (
                <span className="u8a-row__meta">
                  <span className="u8a-tag">Paused</span>
                </span>
              ) : (
                <span className="u8a-row__end">
                  <Button variant="secondary" onClick={() => setTarget(m)}>
                    Pause
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {target ? (
        <Modal title={`Pause ${name(target)}?`} onClose={close}>
          <p>
            Their coach and Branch Staff roles at this School end now. Only the School&apos;s main owner can unpause them, and their roles
            then come back as they were. This is recorded in the audit log and on the School&apos;s Staff activity log.
          </p>
          {pause.error ? <ErrorBanner message={pause.error instanceof ApiError ? pause.error.message : 'Could not pause them.'} /> : null}
          <div className="u8a-buttons">
            <Button loading={pause.isPending} onClick={() => pause.mutate(target.userId, { onSuccess: close })}>
              Pause
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}
