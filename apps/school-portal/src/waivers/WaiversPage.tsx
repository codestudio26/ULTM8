import React, { useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useCreateWaiver, useUpdateWaiver, useWaivers, type WaiverResponse } from './waiverQueries';
import { WaiverFormModal } from './WaiverFormModal';

/** Truncated preview — Waiver.body can run up to 20,000 characters
 * (CreateWaiverDto's own MaxLength), far too long for a table cell. */
function bodyPreview(body: string): string {
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

export function WaiversPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useWaivers(schoolId);
  const createWaiver = useCreateWaiver(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WaiverResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Waivers.'} />;

  const waivers = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Waivers"
        subtitle="Liability waivers Students sign before joining your School."
        actions={<Button onClick={() => setCreating(true)}>Add waiver</Button>}
      />
      <Card>
        {waivers.length === 0 ? (
          <EmptyState title="No Waivers yet" description="Add your first Waiver to get started." />
        ) : (
          <Table<WaiverResponse>
            rows={waivers}
            columns={[
              { key: 'title', header: 'Title', render: (w) => w.title },
              { key: 'body', header: 'Text', render: (w) => bodyPreview(w.body) },
              {
                key: 'actions',
                header: '',
                render: (w) => (
                  <Button variant="secondary" onClick={() => setEditing(w)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creating ? (
        <WaiverFormModal
          title="Add waiver"
          submitting={createWaiver.isPending}
          onSubmit={async (values) => {
            await createWaiver.mutateAsync(values);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditWaiverModal schoolId={schoolId} waiver={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditWaiverModal({ schoolId, waiver, onClose }: { schoolId: string; waiver: WaiverResponse; onClose: () => void }) {
  const updateWaiver = useUpdateWaiver(schoolId, waiver.id);
  return (
    <WaiverFormModal
      title="Edit waiver"
      initial={waiver}
      submitting={updateWaiver.isPending}
      onSubmit={async (values) => {
        await updateWaiver.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
