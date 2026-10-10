import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth } from './AuthContext';
import { rememberReturnTo } from './returnTo';
import { useAcceptCoachInvite, useCoachInviteLink } from '../roleGrants/coachInviteQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * The coach invite link (Decision 183). Anyone holding it sees which School
 * (and branch) it is for and the email it was sent to. Signed in with that
 * email, "Accept" makes the account a coach there; other roles are kept.
 * Signed out, it sends them to log in, or to create their account, and
 * brings them back here afterwards.
 */
export function CoachInvitePage() {
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
      <AuthCard title="Coach invite">
        <ErrorBanner message={errorText(link.error, 'This invite link is not valid.')} />
      </AuthCard>
    );
  }

  const invite = link.data;
  const where = invite.branchName ? `${invite.schoolName} — ${invite.branchName}` : invite.schoolName;

  if (accepted) {
    return (
      <AuthCard title="Coach invite">
        <SuccessBanner message={`You're now a coach at ${where}.`} />
        <Button onClick={() => navigate('/coach')}>Go to your coach dashboard</Button>
      </AuthCard>
    );
  }

  const closed: Partial<Record<typeof invite.status, string>> = {
    ACCEPTED: 'This invite has already been used.',
    CANCELLED: 'This invite was cancelled. Ask the school for a new one.',
    EXPIRED: 'This invite has expired. Ask the school for a new one.',
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
      setError(errorText(err, 'Could not accept the invite.'));
    }
  }

  return (
    <AuthCard title="You're invited to coach" subtitle={where}>
      {error ? <ErrorBanner message={error} /> : null}
      {closedText ? (
        <ErrorBanner message={closedText} />
      ) : !accessToken ? (
        <>
          <p>
            This invite is for <strong>{invite.email}</strong>. Log in with that email, or create your account with it, to accept.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => navigate('/login', { state: { from: { pathname: here } } })}>Log in</Button>
            <Button
              variant="secondary"
              onClick={() => {
                rememberReturnTo(here);
                navigate('/register', { state: { email: invite.email } });
              }}
            >
              Create an account
            </Button>
          </div>
        </>
      ) : rightAccount ? (
        <>
          <p>
            Accept to become a coach at <strong>{where}</strong>. Anything else your account has here, like your student membership, stays as
            it is.
          </p>
          <Button onClick={handleAccept} loading={accept.isPending}>
            Accept invite
          </Button>
        </>
      ) : (
        <>
          <p>
            This invite is for <strong>{invite.email}</strong>, but you're logged in as <strong>{signedInAs}</strong>.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              logout();
              navigate('/login', { state: { from: { pathname: here } } });
            }}
          >
            Log in as {invite.email}
          </Button>
        </>
      )}
    </AuthCard>
  );
}
