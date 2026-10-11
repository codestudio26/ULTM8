import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { nullsToUndefined } from '../lib/nullableFields';
import { useBranches, useCreateBranch, type BranchResponse } from './branchQueries';
import { BranchFormModal } from './BranchFormModal';

export function BranchesPage() {
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  const { data, isLoading, error } = useBranches(schoolId);
  const createBranch = useCreateBranch(schoolId ?? '');
  const [creating, setCreating] = useState(false);

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
                  // Decision 231 — a dedicated settings screen replaces the
                  // previous edit-via-modal path.
                  <Button variant="secondary" onClick={() => navigate(`/branches/${b.id}`)}>
                    Settings
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
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateBranchDto doesn't accept null.
            await createBranch.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
