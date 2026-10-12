import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, EmptyState, ErrorBanner, Field, PageHeader, Spinner, Table, TextField, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { nullsToUndefined } from '../lib/nullableFields';
import { useBranches, useCreateBranch, type BranchResponse } from './branchQueries';
import { BranchFormModal } from './BranchFormModal';

export function BranchesPage() {
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  // Server-side City filter (GET /schools/:schoolId/branches?city=) — Branch has no
  // dedicated city column, so this matches against the free-text address field
  // (see useBranches'/BranchesQueryDto's own header comments). Applied on every
  // keystroke, same immediacy as a client-side filter would have had — no "Filter"
  // submit button, since a single-field substring filter doesn't need one the way
  // TranslationsPage's two-field form does.
  const [cityFilter, setCityFilter] = useState('');
  // Rows/Grid is a pure presentation choice over the same fetched data — kept as
  // local, in-memory state (defaulting to "Rows"), not persisted: no school-portal
  // page persists a view/UI preference today (no localStorage usage exists in this
  // app), so there's no existing convention to match, and a per-session default is
  // the documented low-effort choice here.
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const { data, isLoading, error } = useBranches(schoolId, cityFilter.trim() || undefined);
  const createBranch = useCreateBranch(schoolId ?? '');
  const [creating, setCreating] = useState(false);

  if (!schoolId) return null;

  const branches = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="Physical locations under your School."
        actions={<Button onClick={() => setCreating(true)}>Add branch</Button>}
      />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Field label="City" htmlFor="branches-city-filter" hint="Matches anywhere in a Branch's address.">
              <TextField
                id="branches-city-filter"
                placeholder="Filter by city…"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
              />
            </Field>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} aria-label="Branches view" />
        </div>
      </Card>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Branches.'} />
      ) : (
        <Card>
          {branches.length === 0 ? (
            <EmptyState
              title={cityFilter ? 'No Branches match that city' : 'No Branches yet'}
              description={cityFilter ? 'Try a different city, or clear the filter.' : 'Add your first Branch to get started.'}
            />
          ) : viewMode === 'grid' ? (
            <CardGrid>
              {branches.map((b) => (
                <Card key={b.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <strong>{b.name}</strong>
                    {b.timezone ? <Badge>{b.timezone}</Badge> : null}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{b.address ?? '—'}</p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{b.contactPhone ?? '—'}</p>
                  <div style={{ marginTop: 12 }}>
                    {/* Decision 231 — a dedicated settings screen replaces the
                        previous edit-via-modal path. */}
                    <Button variant="secondary" onClick={() => navigate(`/branches/${b.id}`)}>
                      Settings
                    </Button>
                  </div>
                </Card>
              ))}
            </CardGrid>
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
      )}

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
