import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, SelectField, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useBranches } from '../branches/branchQueries';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { StudentsTabs } from './StudentsTabs';
import { useApproveSignUp, useRejectSignUp, useSignUps, type ApproveSignUpResult, type SignUp, type SignUpView } from './signUpQueries';

function day(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The person's age today, from a date of birth stored as a day. */
function ageOf(iso: string | Date): number {
  const dob = new Date(iso);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/**
 * Sign-ups from the front-desk tablet (Decision 392, handover F5): waiting for
 * staff, rejected in the last 30 days (Decision 362: still approvable, then
 * deleted), and done. The owner sees every Branch's; Branch Staff with the
 * students switch their own Branches'.
 */
export function SignUpsPage() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const [view, setView] = useState<SignUpView>('WAITING');
  const signUps = useSignUps(schoolId, view);
  const [approving, setApproving] = useState<SignUp | null>(null);
  const [rejecting, setRejecting] = useState<SignUp | null>(null);
  const [result, setResult] = useState<{ name: string; result: ApproveSignUpResult } | null>(null);

  if (!schoolId) return null;
  const items = signUps.data?.items ?? [];
  const views: Array<[SignUpView, string]> = [
    ['WAITING', t('students.signUps.viewWaiting')],
    ['REJECTED', t('students.signUps.viewRejected')],
    ['DONE', t('students.signUps.viewDone')],
  ];

  return (
    <>
      <PageHeader title={t('students.title')} subtitle={t('students.signUps.subtitle')} />
      <StudentsTabs />
      <div className="ultm8-tabs" role="tablist" aria-label={t('students.signUps.viewsAria')} style={{ marginBottom: 16 }}>
        {views.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`ultm8-tabs__tab${view === v ? ' ultm8-tabs__tab--active' : ''}`}
            onClick={() => setView(v)}
            style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}
          >
            {label}
          </button>
        ))}
      </div>
      {result ? <ApprovedBanner name={result.name} result={result.result} /> : null}
      {signUps.isLoading ? (
        <Spinner />
      ) : signUps.error ? (
        <ErrorBanner message={signUps.error instanceof ApiError ? signUps.error.message : t('students.signUps.loadFailed')} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={view === 'WAITING' ? t('students.signUps.emptyWaiting') : view === 'REJECTED' ? t('students.signUps.emptyRejected') : t('students.signUps.emptyDone')}
            description={view === 'WAITING' ? t('students.signUps.emptyWaitingHint') : undefined}
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((s) => (
            <SignUpCard key={s.id} signUp={s} onApprove={() => setApproving(s)} onReject={() => setRejecting(s)} />
          ))}
        </div>
      )}
      {approving ? (
        <ApproveModal
          schoolId={schoolId}
          signUp={approving}
          onClose={() => setApproving(null)}
          onDone={(r) => {
            setResult({ name: `${approving.firstName} ${approving.surname}`.trim(), result: r });
            setApproving(null);
          }}
        />
      ) : null}
      {rejecting ? <RejectModal schoolId={schoolId} signUp={rejecting} onClose={() => setRejecting(null)} /> : null}
    </>
  );
}

function SignUpCard({ signUp: s, onApprove, onReject }: { signUp: SignUp; onApprove: () => void; onReject: () => void }) {
  const t = useT();
  const name = `${s.firstName} ${s.surname}`.trim();
  const status =
    s.status === 'PENDING'
      ? { label: t('students.signUps.statusPending'), variant: 'warning' as const }
      : s.status === 'INVITED'
        ? { label: t('students.signUps.statusInvited'), variant: 'info' as const }
        : s.status === 'REJECTED'
          ? { label: t('students.signUps.statusRejected'), variant: 'danger' as const }
          : s.status === 'APPROVED'
            ? { label: t('students.signUps.statusApproved'), variant: 'success' as const }
            : { label: t('students.signUps.statusDeclined'), variant: 'default' as const };
  const rows: Array<[string, string | null | undefined]> = [
    [t('students.signUps.born'), `${day(s.dateOfBirth)} (${t('students.signUps.age', { age: ageOf(s.dateOfBirth) })})`],
    [t('students.signUps.gender'), s.gender === 'FEMALE' ? t('frontDesk.signUp.female') : s.gender === 'MALE' ? t('frontDesk.signUp.male') : null],
    [t('students.signUps.email'), s.email],
    [t('students.signUps.phone'), s.phone],
    [t('students.signUps.heardFrom'), s.heardFrom],
    [
      t('students.signUps.emergency'),
      s.emergencyName || s.emergencyPhone ? [s.emergencyName, s.emergencyRelationship ? `(${s.emergencyRelationship})` : null, s.emergencyPhone].filter(Boolean).join(' ') : null,
    ],
    [t('students.signUps.branch'), s.branchName],
    [t('students.signUps.sent'), day(s.createdAt)],
  ];
  return (
    <Card>
      <div data-testid="sign-up" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
              {name}
            </h2>
            <Badge variant={s.kind === 'VISITOR' ? 'info' : 'accent'}>{s.kind === 'VISITOR' ? t('frontDesk.signUp.visitor') : t('frontDesk.signUp.member')}</Badge>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: 0, fontSize: 14 }}>
            {rows
              .filter(([, v]) => !!v)
              .map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt style={{ color: 'var(--color-neutral-600)' }}>{label}</dt>
                  <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
                </React.Fragment>
              ))}
          </dl>
          <p style={{ margin: '8px 0 0', color: 'var(--color-neutral-600)', fontSize: 13 }}>
            {s.status === 'PENDING' && s.hasAccount ? t('students.signUps.hasAccount') : null}
            {s.status === 'INVITED' ? t('students.signUps.invitedNote', { name: s.approvedByName ?? '—' }) : null}
            {s.status === 'REJECTED' && s.deletesAt
              ? t('students.signUps.rejectedNote', { name: s.rejectedByName ?? '—', date: day(s.deletesAt) })
              : null}
            {s.status === 'APPROVED' ? t('students.signUps.approvedNote', { name: s.approvedByName ?? '—', date: s.approvedAt ? day(s.approvedAt) : '' }) : null}
            {s.status === 'APPROVED' && s.rejectedByName ? ` ${t('students.signUps.earlierRejected', { name: s.rejectedByName })}` : null}
            {s.status === 'DECLINED' ? t('students.signUps.declinedNote') : null}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {s.status === 'PENDING' || s.status === 'REJECTED' ? <Button onClick={onApprove}>{t('students.signUps.approve')}</Button> : null}
          {s.status === 'PENDING' ? (
            <Button variant="secondary" onClick={onReject}>
              {t('students.signUps.reject')}
            </Button>
          ) : null}
          {s.status === 'INVITED' ? (
            <Button variant="secondary" onClick={onReject}>
              {t('students.signUps.withdraw')}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function ApprovedBanner({ name, result }: { name: string; result: ApproveSignUpResult }) {
  const t = useT();
  const parts = [
    result.invited ? t('students.signUps.approvedInvited', { name }) : t('students.signUps.approvedNew', { name }),
    result.visitPassGiven ? t('students.signUps.approvedPass') : null,
    result.emailFailed && !result.temporaryPasscode ? t('students.signUps.emailFailed') : null,
  ].filter(Boolean);
  return (
    <div style={{ marginBottom: 16 }}>
      <SuccessBanner message={parts.join(' ')} />
      {result.temporaryPasscode ? (
        <p role="status" style={{ margin: '8px 0 0' }}>
          {t('students.signUps.passcodeHandOver', { code: result.temporaryPasscode })}
        </p>
      ) : null}
    </div>
  );
}

function ApproveModal({ schoolId, signUp, onClose, onDone }: { schoolId: string; signUp: SignUp; onClose: () => void; onDone: (r: ApproveSignUpResult) => void }) {
  const t = useT();
  const approve = useApproveSignUp(schoolId);
  const branches = (useBranches(schoolId).data?.items ?? []).filter((b) => !b.archivedAt);
  // A School-wide tablet at a School with branches: choose the home branch.
  const needsBranch = !signUp.branchId && !signUp.hasAccount && branches.length > 0;
  const [branchId, setBranchId] = useState('');
  const name = `${signUp.firstName} ${signUp.surname}`.trim();
  return (
    <Modal title={t('students.signUps.approveTitle', { name })} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{signUp.hasAccount ? t('students.signUps.approveInviteBody') : t('students.signUps.approveNewBody')}</p>
      {signUp.kind === 'VISITOR' ? <p>{t('students.signUps.approveVisitorBody')}</p> : null}
      {needsBranch ? (
        <Field label={t('students.signUps.homeBranch')} htmlFor="sign-up-branch">
          <SelectField
            id="sign-up-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[{ value: '', label: t('students.signUps.chooseBranch') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
      ) : null}
      {approve.error ? <ErrorBanner message={approve.error instanceof ApiError ? approve.error.message : t('students.signUps.approveFailed')} /> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={approve.isPending || (needsBranch && !branchId)}
          onClick={() => approve.mutate({ id: signUp.id, branchId: branchId || undefined }, { onSuccess: onDone })}
        >
          {t('students.signUps.approveConfirm')}
        </Button>
      </div>
    </Modal>
  );
}

function RejectModal({ schoolId, signUp, onClose }: { schoolId: string; signUp: SignUp; onClose: () => void }) {
  const t = useT();
  const reject = useRejectSignUp(schoolId);
  const name = `${signUp.firstName} ${signUp.surname}`.trim();
  const withdrawing = signUp.status === 'INVITED';
  return (
    <Modal title={withdrawing ? t('students.signUps.withdrawTitle', { name }) : t('students.signUps.rejectTitle', { name })} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{t('students.signUps.rejectBody')}</p>
      {reject.error ? <ErrorBanner message={reject.error instanceof ApiError ? reject.error.message : t('students.signUps.rejectFailed')} /> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" disabled={reject.isPending} onClick={() => reject.mutate(signUp.id, { onSuccess: onClose })}>
          {withdrawing ? t('students.signUps.withdraw') : t('students.signUps.rejectConfirm')}
        </Button>
      </div>
    </Modal>
  );
}

/** Whether the caller may see the Sign-ups tab: the owner, or Branch Staff
 * with the students switch (the API's own rule). */
export function useMaySeeSignUps(schoolId: string | null): boolean {
  const access = useMyStaffAccess(schoolId).data;
  return !!access && (access.owner || (access.branchStaff && access.access.students));
}
