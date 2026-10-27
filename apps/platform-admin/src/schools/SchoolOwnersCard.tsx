import { useState } from 'react';
import { Badge, Button, Card, Checkbox, ErrorBanner, Modal, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useChangeSchoolMainOwner, useSchoolOwners } from './schoolQueries';

type Owner = { userId: string; firstName: string; surname: string; email: string; mainOwner: boolean; ownerSince: string };

/**
 * Decision 370 — a School's owners. Nobody inside the School can remove its
 * main owner, so ULTM8 support does it here: make a co-owner the main owner,
 * optionally ending the former main owner's owner role in the same step.
 * Reading is open to every tier; the change itself is Full Admin only
 * server-side, and a lower tier sees that refusal as an error here.
 */
export function SchoolOwnersCard({ schoolId }: { schoolId: string }) {
  const owners = useSchoolOwners(schoolId);
  const change = useChangeSchoolMainOwner(schoolId);
  const [target, setTarget] = useState<Owner | null>(null);
  const [removeFormer, setRemoveFormer] = useState(false);
  const main = owners.data?.items.find((o) => o.mainOwner);
  const name = (o: Owner) => `${o.firstName} ${o.surname}`.trim();

  function close() {
    setTarget(null);
    setRemoveFormer(false);
    change.reset();
  }

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Owners</h3>
      {owners.isLoading ? <Spinner /> : null}
      {owners.error ? <ErrorBanner message={owners.error instanceof ApiError ? owners.error.message : 'Could not load the owners.'} /> : null}
      {owners.data && owners.data.items.length === 0 ? <p>This School has no owners.</p> : null}
      {owners.data && owners.data.items.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {owners.data.items.map((o) => (
            <li key={o.userId} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: '6px 0' }}>
              <span>
                <strong>{name(o)}</strong> · {o.email}
              </span>
              <Badge variant={o.mainOwner ? 'accent' : undefined}>{o.mainOwner ? 'Main owner' : 'Co-owner'}</Badge>
              <span style={{ opacity: 0.7, fontSize: 13 }}>since {new Date(o.ownerSince).toLocaleDateString()}</span>
              {!o.mainOwner ? (
                <Button variant="secondary" onClick={() => setTarget(o)}>
                  Make main owner
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {owners.data && owners.data.items.length === 1 ? (
        <p style={{ opacity: 0.7, fontSize: 13 }}>To replace the main owner, the School first needs a co-owner.</p>
      ) : null}

      {target ? (
        <Modal title={`Make ${name(target)} the main owner?`} onClose={close}>
          <p>
            {main ? `${name(main)} stops being the main owner and stays a co-owner, unless you remove them below.` : null} This is
            recorded in the audit log.
          </p>
          {change.error ? <ErrorBanner message={change.error instanceof ApiError ? change.error.message : 'Could not change the main owner.'} /> : null}
          {main ? (
            <Checkbox
              label={`Also remove ${name(main)} as an owner of this School`}
              checked={removeFormer}
              onChange={(e) => setRemoveFormer(e.target.checked)}
            />
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              loading={change.isPending}
              onClick={() => change.mutate({ userId: target.userId, removeFormerMainOwner: removeFormer }, { onSuccess: close })}
            >
              Make main owner
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
