import React, { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, Modal, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCloseTenantAccount, useReactivateTenantAccount } from './tenantLifecycleQueries';

interface TenantLifecycleControlsProps {
  kind: 'school' | 'franchise';
  id: string;
  name: string;
  archivedAt: string | null | undefined;
  purgeAt: string | null | undefined;
  purgedAt: string | null | undefined;
}

/** Phase 57 (Decision 110/Phase 56) — the close/reactivate action, added to
 * SchoolLookupPage/FranchiseLookupPage. Shares one implementation across both
 * entity kinds — TenantLifecycleModule's own close/reactivate endpoints are
 * identical in shape for School and Franchise (see that module's own header
 * comment), and so is this control.
 *
 * The re-typed-name confirmation (Decision 110's own recommendation, "given
 * the consequence") is a plain inline form inside a Modal, not a bespoke
 * dialog component — matches every other write flow in this app (a submit
 * button, an ErrorBanner on failure), just gated behind an extra confirm
 * step for this one genuinely hard-to-reverse action.
 */
export function TenantLifecycleControls({ kind, id, name, archivedAt, purgeAt, purgedAt }: TenantLifecycleControlsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const closeAccount = useCloseTenantAccount(kind);
  const reactivate = useReactivateTenantAccount(kind);
  const label = kind === 'school' ? 'School' : 'Franchise';

  function handleClose(e: React.FormEvent) {
    e.preventDefault();
    closeAccount.mutate(
      { id, body: { confirmName } },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setConfirmName('');
        },
      },
    );
  }

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Account status</h3>

      {archivedAt ? (
        <>
          <p>
            <Badge variant="danger">Closed</Badge> {new Date(archivedAt).toLocaleString()}
            {purgedAt ? (
              <> — purged {new Date(purgedAt).toLocaleString()}</>
            ) : purgeAt ? (
              <> — scheduled for permanent deletion {new Date(purgeAt).toLocaleString()}</>
            ) : null}
          </p>
          {purgedAt ? (
            <p>This {label} has already been purged and can no longer be reactivated.</p>
          ) : (
            <>
              <Button variant="secondary" onClick={() => reactivate.mutate(id)} loading={reactivate.isPending}>
                Reactivate
              </Button>
              {reactivate.error ? (
                <div style={{ marginTop: 8 }}>
                  <ErrorBanner
                    message={
                      reactivate.error instanceof ApiError ? reactivate.error.message : `Could not reactivate this ${label}.`
                    }
                  />
                </div>
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          <p>
            <Badge variant="success">Active</Badge>
          </p>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Close account
          </Button>
        </>
      )}

      {confirmOpen ? (
        <Modal title={`Close this ${label}'s account`} onClose={() => setConfirmOpen(false)}>
          <p>
            This soft-archives <strong>{name}</strong> immediately — read-only, no new or updated records anywhere in
            this platform — and permanently deletes it 90 days from now unless reactivated first. Type the{' '}
            {label.toLowerCase()}'s exact name to confirm.
          </p>
          <form onSubmit={handleClose}>
            <Field label={`${label} name`} htmlFor="confirm-name-input">
              <TextField
                id="confirm-name-input"
                required
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={name}
              />
            </Field>
            {closeAccount.error ? (
              <ErrorBanner
                message={
                  closeAccount.error instanceof ApiError
                    ? closeAccount.error.message
                    : `Could not close this ${label}'s account.`
                }
              />
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button type="submit" variant="danger" loading={closeAccount.isPending}>
                Close account
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}
