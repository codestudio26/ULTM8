import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { fetchInviteCandidate, type InviteCandidateResponse } from '../roleGrants/roleGrantQueries';
import {
  useAddGuardianLinkConfirmer,
  useConfirmGuardianLink,
  useGuardianLinkConfirmers,
  useGuardianLinks,
  useRemoveGuardianLinkConfirmer,
  useUnconfirmGuardianLink,
  type GuardianLinkConfirmer,
  type GuardianLinkStatusFilter,
  type SchoolGuardianLink,
} from './guardianLinkQueries';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Decision 172 — confirming that a Guardian really is a minor student's Guardian.
 * A Guardian can give consent for a minor only after a School confirms the link.
 * The owner sees every enrolled minor's links and decides which staff may also
 * confirm. Staff given that right confirm through the API; this portal is
 * owner-only today (useOwnedSchoolId), so they have no screen here yet.
 */
export function GuardiansPage() {
  const schoolId = useOwnedSchoolId();
  if (!schoolId) return null;
  return (
    <>
      <PageHeader
        title="Guardians"
        subtitle="Confirm parents and guardians of your minor students. A Guardian can give consent for a child only once a School has confirmed them."
      />
      <GuardianLinksCard schoolId={schoolId} />
      <ConfirmersCard schoolId={schoolId} />
    </>
  );
}

type LinkRow = SchoolGuardianLink & { id: string };

function GuardianLinksCard({ schoolId }: { schoolId: string }) {
  const [status, setStatus] = useState<GuardianLinkStatusFilter>('pending');
  const { data, isLoading, error } = useGuardianLinks(schoolId, status);
  const confirm = useConfirmGuardianLink(schoolId);
  const unconfirm = useUnconfirmGuardianLink(schoolId);
  const [actionError, setActionError] = useState<string | null>(null);
  // The row whose button is busy, tracked here rather than read off a shared
  // mutation's `variables` (see platform-admin's AdminUsersPage review note).
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

  async function run(linkId: string, action: () => Promise<unknown>, fallback: string) {
    setActionError(null);
    setBusyLinkId(linkId);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err, fallback));
    } finally {
      setBusyLinkId(null);
    }
  }

  const rows: LinkRow[] = (data?.items ?? []).map((l) => ({ ...l, id: l.linkId }));

  return (
    <Card className="ultm8-field">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          Guardian links
        </h2>
        <Field label="Show" htmlFor="guardian-link-status">
          <SelectField
            id="guardian-link-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as GuardianLinkStatusFilter)}
            options={[
              { value: 'pending', label: 'Waiting for confirmation' },
              { value: 'confirmed', label: 'Confirmed' },
            ]}
          />
        </Field>
      </div>
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={errorMessage(error, 'Could not load Guardian links.')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={status === 'pending' ? 'Nothing waiting' : 'No confirmed Guardians yet'}
          description="Guardians appear here once their child is enrolled at your School."
        />
      ) : (
        <Table<LinkRow>
          rows={rows}
          columns={[
            {
              key: 'student',
              header: 'Student',
              render: (l) => (
                <>
                  {l.studentFirstName} {l.studentSurname}
                  <br />
                  <small>Born {new Date(l.studentDateOfBirth).toLocaleDateString()}</small>
                </>
              ),
            },
            {
              key: 'guardian',
              header: 'Guardian',
              render: (l) => (
                <>
                  {l.guardianFirstName} {l.guardianSurname}
                  <br />
                  <small>{l.guardianPhone}</small>
                </>
              ),
            },
            { key: 'linkedAt', header: 'Linked', render: (l) => new Date(l.linkedAt).toLocaleDateString() },
            {
              key: 'status',
              header: 'Status',
              render: (l) =>
                l.confirmedAt ? (
                  <Badge variant="success">
                    Confirmed {new Date(l.confirmedAt).toLocaleDateString()}
                    {l.confirmedSchoolId !== schoolId ? ' by another School' : ''}
                  </Badge>
                ) : (
                  <Badge variant="accent">Waiting</Badge>
                ),
            },
            {
              key: 'actions',
              header: '',
              render: (l) =>
                !l.confirmedAt ? (
                  <Button
                    loading={busyLinkId === l.linkId}
                    disabled={busyLinkId !== null}
                    onClick={() => run(l.linkId, () => confirm.mutateAsync(l.linkId), 'Could not confirm this Guardian.')}
                  >
                    Confirm
                  </Button>
                ) : l.confirmedSchoolId === schoolId ? (
                  <Button
                    variant="secondary"
                    loading={busyLinkId === l.linkId}
                    disabled={busyLinkId !== null}
                    onClick={() => {
                      if (window.confirm(`Un-confirm ${l.guardianFirstName} ${l.guardianSurname} as Guardian of ${l.studentFirstName}? They won't be able to give new consent until a School confirms them again.`)) {
                        void run(l.linkId, () => unconfirm.mutateAsync(l.linkId), 'Could not un-confirm this Guardian.');
                      }
                    }}
                  >
                    Un-confirm
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      <p>
        <small>
          Only confirm a Guardian once you have checked, in person or from your records, that they are the child's parent or legal guardian.
        </small>
      </p>
    </Card>
  );
}

function ConfirmersCard({ schoolId }: { schoolId: string }) {
  const { data, isLoading, error } = useGuardianLinkConfirmers(schoolId);
  const add = useAddGuardianLinkConfirmer(schoolId);
  const remove = useRemoveGuardianLinkConfirmer(schoolId);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [candidate, setCandidate] = useState<InviteCandidateResponse | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);
    if (!email && !phone) {
      setFormError('Enter an email or phone number to search.');
      return;
    }
    setFindLoading(true);
    try {
      const result = await fetchInviteCandidate(schoolId, { email: email || undefined, phone: phone || undefined });
      if (!result.found) {
        setFormError('No ULTM8 account found with that email or phone.');
        setCandidate(null);
        return;
      }
      setCandidate(result);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not search for this person.'));
    } finally {
      setFindLoading(false);
    }
  }

  async function handleAdd() {
    setFormError(null);
    try {
      await add.mutateAsync(candidate!.id!);
      setSuccess(`${candidate!.firstName} ${candidate!.surname} can now confirm Guardians for their branches' students.`);
      setCandidate(null);
      setEmail('');
      setPhone('');
    } catch (err) {
      setFormError(errorMessage(err, 'Could not give this right.'));
    }
  }

  const confirmers: GuardianLinkConfirmer[] = data?.items ?? [];

  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        Who else can confirm
      </h2>
      <p>
        You can always confirm. You can also let Instructors or Branch Staff confirm Guardians of the students in their own branches.
      </p>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={errorMessage(error, 'Could not load this list.')} />
      ) : confirmers.length === 0 ? (
        <p>
          <small>Only you can confirm Guardians at the moment.</small>
        </p>
      ) : (
        <Table<GuardianLinkConfirmer>
          rows={confirmers}
          columns={[
            {
              key: 'name',
              header: 'Staff member',
              render: (c) => (c.userFirstName ? `${c.userFirstName} ${c.userSurname ?? ''}` : c.userId),
            },
            { key: 'since', header: 'Since', render: (c) => new Date(c.createdAt).toLocaleDateString() },
            {
              key: 'actions',
              header: '',
              render: (c) => (
                <Button
                  variant="secondary"
                  loading={removingUserId === c.userId}
                  disabled={removingUserId !== null}
                  onClick={async () => {
                    setFormError(null);
                    setRemovingUserId(c.userId);
                    try {
                      await remove.mutateAsync(c.userId);
                    } catch (err) {
                      setFormError(errorMessage(err, 'Could not remove this right.'));
                    } finally {
                      setRemovingUserId(null);
                    }
                  }}
                >
                  Remove
                </Button>
              ),
            },
          ]}
        />
      )}

      {success ? <SuccessBanner message={success} /> : null}
      {formError ? <ErrorBanner message={formError} /> : null}
      {!candidate ? (
        <form onSubmit={handleFind}>
          <Field label="Staff email" htmlFor="confirmer-email" hint="Exact match only. Provide email or phone.">
            <TextField id="confirmer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Staff phone" htmlFor="confirmer-phone" hint="E.164 format, e.g. +14155551234">
            <TextField id="confirmer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" loading={findLoading}>
            Find staff member
          </Button>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>
            Found <strong>{candidate.firstName} {candidate.surname}</strong>.
          </span>
          <Button loading={add.isPending} onClick={handleAdd}>
            Allow to confirm
          </Button>
          <Button variant="secondary" onClick={() => setCandidate(null)}>
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}
