import React, { useState } from 'react';
import { Button, Card, ErrorBanner, Field, PageHeader, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useStartImpersonationSession, type ImpersonationSessionResponse } from './impersonationQueries';

/** Slice 4 (Phase 48) — the UI for PlatformAdminModule's Support-tier
 * impersonation (Phase 43, Decision 102; scoped down to one School by Spec 55
 * Decision 39, closed at the RLS level in Phase 47). Look-up-by-known-id only,
 * same as SchoolLookupPage/FranchiseLookupPage — StartImpersonationSessionDto's
 * own comment is explicit that this endpoint has no way to find a User by
 * email/name, so this form takes both ids directly rather than guessing at a
 * search capability that doesn't exist.
 *
 * What this screen deliberately does NOT do: hand the resulting accessToken to
 * apps/school-portal automatically (e.g. opening it in a new tab pre-logged-in).
 * No such cross-app hand-off mechanism exists anywhere in this monorepo today,
 * and building one is new scope Decision 102 never addressed — it confirms the
 * session itself is read-only/time-boxed, not how a Platform Admin operator
 * gets from "session minted" to "looking at the tenant UI as that user." Until
 * that's confirmed, this mirrors PaymentAccountDetails' own precedent (Phase
 * 35's "Rotate credential" surfaces a raw Stripe URL for the operator to relay,
 * rather than completing the flow itself) — the token and its expiry are
 * surfaced directly for the Support agent to use themselves. Flagged for
 * Architect/product review, same treatment this codebase gives every other
 * judgment call beyond a confirmed rule. */
export function ImpersonationPage() {
  const startSession = useStartImpersonationSession();
  const [userId, setUserId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [session, setSession] = useState<ImpersonationSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSession(null);
    try {
      const result = await startSession.mutateAsync({ userId: userId.trim(), schoolId: schoolId.trim() });
      setSession(result);
    } catch (err) {
      // Surfaces the server's own 403 (not Support/Full Admin, Decision 102) or
      // 404 (unknown User) directly — not re-derived or guessed at client-side,
      // same convention InviteAdminModal's own comment already establishes.
      setError(err instanceof ApiError ? err.message : 'Could not start this impersonation session.');
    }
  }

  return (
    <>
      <PageHeader
        title="Impersonation"
        subtitle="Start a read-only, time-boxed session as a tenant User, scoped to one School (Decision 39). Support or Full Admin only. Every session start is audit-logged."
      />
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="User ID" htmlFor="impersonation-user-id" hint="The tenant User to impersonate — from a support ticket or an existing cross-tenant read. There is no lookup-by-email here.">
            <TextField id="impersonation-user-id" required value={userId} onChange={(e) => setUserId(e.target.value)} />
          </Field>
          <Field label="School ID" htmlFor="impersonation-school-id" hint="The one School this session is scoped to — not the User's other Schools/Franchises, if any.">
            <TextField id="impersonation-school-id" required value={schoolId} onChange={(e) => setSchoolId(e.target.value)} />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" loading={startSession.isPending}>
            Start impersonation session
          </Button>
        </form>
      </Card>

      {session ? (
        <Card>
          <h3 style={{ marginTop: 0 }}>Session started</h3>
          <SuccessBanner message="Use this access token exactly like a tenant app would: Authorization: Bearer <token>. Any non-read request is rejected server-side (Decision 102)." />
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', marginTop: 16 }}>
            <dt>Impersonated User</dt>
            <dd>{session.impersonatedUserId}</dd>
            <dt>Expires</dt>
            <dd>{new Date(session.expiresAt).toLocaleString()}</dd>
            <dt>Access token</dt>
            <dd>
              <code style={{ wordBreak: 'break-all' }}>{session.accessToken}</code>
            </dd>
          </dl>
        </Card>
      ) : null}
    </>
  );
}
