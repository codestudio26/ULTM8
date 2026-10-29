import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth } from './AuthContext';
import { rememberReturnTo } from './returnTo';
import { useAcceptCoachInvite, useCoachInviteLink } from '../roleGrants/coachInviteQueries';
import { useT } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * The coach invite link (Decision 183). Anyone holding it sees which School
 * (and branch) it is for and the email it was sent to. Signed in with that
 * email, "Accept" makes the account a coach there; other roles are kept.
 * Signed out, it sends them to log in, or to create their account, and
 * brings them back here afterwards.
 *
 * Decision 396: the same link also invites Branch Staff, when the School asks
 * new staff to accept first; the words then say staff, not coach.
 */
export function CoachInvitePage() {
  const t = useT();
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { accessToken, claims, setAccessToken, logout } = useAuth();
  const link = useCoachInviteLink(token);
  const accept = useAcceptCoachInvite(token);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const here = `/coach-invite/${token}`;

  if (link.isLoading) return <Spinner />;
  if (link.error || !link.data) {
    return (
      <AuthCard title={t('auth.coachInvite.title')}>
        <ErrorBanner message={errorText(link.error, t('auth.coachInvite.invalid'))} />
      </AuthCard>
    );
  }

  const invite = link.data;
  const staff = invite.role === 'BRANCH_STAFF';
  const where = invite.branchName ? `${invite.schoolName} — ${invite.branchName}` : invite.schoolName;

  if (accepted) {
    return (
      <AuthCard title={t(staff ? 'auth.coachInvite.staffTitle' : 'auth.coachInvite.title')}>
        <SuccessBanner message={t(staff ? 'auth.coachInvite.staffAccepted' : 'auth.coachInvite.accepted', { where })} />
        <Button onClick={() => navigate(staff ? '/' : '/coach')}>
          {t(staff ? 'auth.coachInvite.staffGoToPortal' : 'auth.coachInvite.goToDashboard')}
        </Button>
      </AuthCard>
    );
  }

  const closed: Partial<Record<typeof invite.status, string>> = {
    ACCEPTED: t('auth.coachInvite.alreadyUsed'),
    CANCELLED: t('auth.coachInvite.cancelled'),
    EXPIRED: t('auth.coachInvite.expired'),
  };
  const closedText = closed[invite.status];
  const signedInAs = claims?.email ?? null;
  const rightAccount = !!signedInAs && signedInAs.trim().toLowerCase() === invite.email;

  async function handleAccept() {
    setError(null);
    try {
      const result = await accept.mutateAsync();
      setAccessToken(result.accessToken);
      setAccepted(true);
    } catch (err) {
      setError(errorText(err, t('auth.coachInvite.acceptFailed')));
    }
  }

  return (
    <AuthCard title={t(staff ? 'auth.coachInvite.staffInvitedTitle' : 'auth.coachInvite.invitedTitle')} subtitle={where}>
      {error ? <ErrorBanner message={error} /> : null}
      {closedText ? (
        <ErrorBanner message={closedText} />
      ) : !accessToken ? (
        <>
          <p>
            <Trans k="auth.coachInvite.signedOutBody" nodes={{ email: <strong>{invite.email}</strong> }} />
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => navigate('/login', { state: { from: { pathname: here } } })}>{t('auth.logIn')}</Button>
            <Button
              variant="secondary"
              onClick={() => {
                rememberReturnTo(here);
                navigate('/register', { state: { email: invite.email } });
              }}
            >
              {t('auth.createAccountLink')}
            </Button>
          </div>
        </>
      ) : rightAccount ? (
        <>
          <p>
            <Trans k={staff ? 'auth.coachInvite.staffAcceptBody' : 'auth.coachInvite.acceptBody'} nodes={{ where: <strong>{where}</strong> }} />
          </p>
          <Button onClick={handleAccept} loading={accept.isPending}>
            {t('auth.coachInvite.acceptButton')}
          </Button>
        </>
      ) : (
        <>
          <p>
            <Trans k="auth.coachInvite.wrongAccountBody" nodes={{ email: <strong>{invite.email}</strong>, signedInAs: <strong>{signedInAs}</strong> }} />
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              logout();
              navigate('/login', { state: { from: { pathname: here } } });
            }}
          >
            {t('auth.coachInvite.logInAs', { email: invite.email })}
          </Button>
        </>
      )}
    </AuthCard>
  );
}
