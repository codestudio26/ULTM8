import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, useCreateBranch, useUpdateBranch, type BranchResponse } from './branchQueries';
import { BranchFormModal } from './BranchFormModal';

export function BranchesPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useBranches(schoolId);
  const createBranch = useCreateBranch(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BranchResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Branches.'} />;

  const branches = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="Physical locations under your School."
        actions={<Button onClick={() => setCreating(true)}>Add branch</Button>}
      />
      <Card>
        {branches.length === 0 ? (
          <EmptyState title="No Branches yet" description="Add your first Branch to get started." />
        ) : (
          <Table<BranchResponse>
            rows={branches}
            columns={[
              { key: 'name', header: 'Name', render: (b) => b.name },
              { key: 'address', header: 'Address', render: (b) => b.address ?? '—' },
              { key: 'phone', header: 'Contact phone', render: (b) => b.contactPhone ?? '—' },
              { key: 'timezone', header: 'Timezone', render: (b) => (b.timezone ? <Badge>{b.timezone}</Badge> : '—') },
              {
                key: 'actions',
                header: '',
                render: (b) => (
                  <Button variant="secondary" onClick={() => setEditing(b)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creating ? (
        <BranchFormModal
          title="Add branch"
          submitting={createBranch.isPending}
          onSubmit={async (values) => {
            await createBranch.mutateAsync(values);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditBranchModal schoolId={schoolId} branch={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditBranchModal({ schoolId, branch, onClose }: { schoolId: string; branch: BranchResponse; onClose: () => void }) {
  const updateBranch = useUpdateBranch(schoolId, branch.id);
  return (
    <BranchFormModal
      title="Edit branch"
      initial={branch}
      submitting={updateBranch.isPending}
      onSubmit={async (values) => {
        await updateBranch.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
