import React, { useState } from 'react';
import { Badge, Button, EmptyState, ErrorBanner, Modal, ModalActions, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useBranches } from '../branches/branchQueries';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { StudentsHeader } from './StudentsTabs';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookSelect } from '../layout/NewLookSelect';
import './studentsSection.css';
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
 *
 * New look (Decision 453): the approved design draws no Sign-ups screen, so
 * the page keeps its views, cards and actions and takes the new header and
 * tabs, a pill switch for the three views, white cards with the new tags and
 * pill buttons, and the shared dialog with its button band.
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
      <BillingPage>
        <StudentsHeader subtitle={t('students.signUps.subtitle')} />
        {/* The three views: one look with the style switch (DESIGN.md →
            "Style switch"), a grey track with the chosen one white. */}
        <div className="ultm8-pills u8st-views" role="tablist" aria-label={t('students.signUps.viewsAria')}>
          {views.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className="ultm8-pills__option" onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        {result ? <ApprovedBanner name={result.name} result={result.result} /> : null}
        {signUps.isLoading ? (
          <BillingCard>
            <Spinner />
          </BillingCard>
        ) : signUps.error ? (
          <ErrorBanner message={signUps.error instanceof ApiError ? signUps.error.message : t('students.signUps.loadFailed')} />
        ) : items.length === 0 ? (
          <BillingCard>
            <EmptyState
              title={view === 'WAITING' ? t('students.signUps.emptyWaiting') : view === 'REJECTED' ? t('students.signUps.emptyRejected') : t('students.signUps.emptyDone')}
              description={view === 'WAITING' ? t('students.signUps.emptyWaitingHint') : undefined}
            />
          </BillingCard>
        ) : (
          <div className="u8st-cards">
            {items.map((s) => (
              <SignUpCard key={s.id} signUp={s} onApprove={() => setApproving(s)} onReject={() => setRejecting(s)} />
            ))}
          </div>
        )}
      </BillingPage>
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
  const note = [
    s.status === 'PENDING' && s.hasAccount ? t('students.signUps.hasAccount') : null,
    s.status === 'INVITED' ? t('students.signUps.invitedNote', { name: s.approvedByName ?? '—' }) : null,
    s.status === 'REJECTED' && s.deletesAt ? t('students.signUps.rejectedNote', { name: s.rejectedByName ?? '—', date: day(s.deletesAt) }) : null,
    s.status === 'APPROVED' ? t('students.signUps.approvedNote', { name: s.approvedByName ?? '—', date: s.approvedAt ? day(s.approvedAt) : '' }) : null,
    s.status === 'APPROVED' && s.rejectedByName ? ` ${t('students.signUps.earlierRejected', { name: s.rejectedByName })}` : null,
    s.status === 'DECLINED' ? t('students.signUps.declinedNote') : null,
  ]
    .filter(Boolean)
    .join('');
  return (
    <section className="u8b-card u8st-signup" data-testid="sign-up">
      <div className="u8st-signup__head">
        <h2 className="u8st-signup__name">{name}</h2>
        <Badge variant={s.kind === 'VISITOR' ? 'info' : 'accent'}>{s.kind === 'VISITOR' ? t('frontDesk.signUp.visitor') : t('frontDesk.signUp.member')}</Badge>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <dl className="u8st-facts">
        {rows
          .filter(([, v]) => !!v)
          .map(([label, value]) => (
            <div key={label} className="u8st-facts__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {note ? <p className="u8b-note u8st-signup__note">{note}</p> : null}
      {s.status === 'PENDING' || s.status === 'REJECTED' || s.status === 'INVITED' ? (
        <div className="u8st-signup__actions">
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
      ) : null}
    </section>
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
    <div className="u8st-approved">
      <SuccessBanner message={parts.join(' ')} />
      {result.temporaryPasscode ? (
        <p role="status" className="u8st-approved__code">
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
      <p>{signUp.hasAccount ? t('students.signUps.approveInviteBody') : t('students.signUps.approveNewBody')}</p>
      {signUp.kind === 'VISITOR' ? <p>{t('students.signUps.approveVisitorBody')}</p> : null}
      {needsBranch ? (
        <div className="u8n-dd-field">
          <NewLookSelect
            id="sign-up-branch"
            label={t('students.signUps.homeBranch')}
            value={branchId}
            onChange={setBranchId}
            options={[{ value: '', label: t('students.signUps.chooseBranch') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </div>
      ) : null}
      {approve.error ? <ErrorBanner message={approve.error instanceof ApiError ? approve.error.message : t('students.signUps.approveFailed')} /> : null}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={approve.isPending || (needsBranch && !branchId)}
          onClick={() => approve.mutate({ id: signUp.id, branchId: branchId || undefined }, { onSuccess: onDone })}
        >
          {t('students.signUps.approveConfirm')}
        </Button>
      </ModalActions>
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
      <p>{t('students.signUps.rejectBody')}</p>
      {reject.error ? <ErrorBanner message={reject.error instanceof ApiError ? reject.error.message : t('students.signUps.rejectFailed')} /> : null}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" disabled={reject.isPending} onClick={() => reject.mutate(signUp.id, { onSuccess: onClose })}>
          {withdrawing ? t('students.signUps.withdraw') : t('students.signUps.rejectConfirm')}
        </Button>
      </ModalActions>
    </Modal>
  );
}

/** Whether the caller may see the Sign-ups tab: the owner, or Branch Staff
 * with the students switch (the API's own rule). */
export function useMaySeeSignUps(schoolId: string | null): boolean {
  const access = useMyStaffAccess(schoolId).data;
  return !!access && (access.owner || (access.branchStaff && access.access.students));
}
