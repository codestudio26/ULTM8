import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table, TextField, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useCreateFranchise, useFranchiseBillingStatus, useFranchises, useUpdateFranchise, type FeeModel, type FranchiseResponse } from './franchiseQueries';
import { FranchiseFormModal } from './FranchiseFormModal';
import { useT } from '../i18n/I18nProvider';

/** Top-level, always-visible nav entry (same convention as every other
 * screen in this Shell — nav items aren't role-gated client-side; the
 * backend is the actual authorization boundary). A user with no Franchise
 * yet reaches "Add franchise" from here, same self-service creation flow
 * School onboarding already established. GET /franchises is already scoped
 * to the caller's own owned Franchises server-side, so this list is never a
 * cross-tenant view — see franchiseQueries.ts's own comment. */
export function FranchisesPage() {
  const navigate = useNavigate();
  const t = useT();
  // Server-side Fee model / Activity filters (GET /franchises?feeModel=&activity=).
  const [feeModelFilter, setFeeModelFilter] = useState<FeeModel | ''>('');
  const [activityFilter, setActivityFilter] = useState('');
  // Rows/Grid is a pure presentation choice over the same fetched data — kept as
  // local, in-memory state (defaulting to "Rows"), not persisted: no school-portal
  // page persists a view/UI preference today (no localStorage usage exists in this
  // app), so there's no existing convention to match, and a per-session default is
  // the documented low-effort choice here.
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const { data, isLoading, error } = useFranchises({
    feeModel: feeModelFilter || undefined,
    activity: activityFilter.trim() || undefined,
  });
  const createFranchise = useCreateFranchise();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FranchiseResponse | null>(null);

  const franchises = data?.items ?? [];
  const hasFilter = feeModelFilter !== '' || activityFilter.trim() !== '';

  return (
    <>
      <PageHeader
        title={t('franchises.list.title')}
        subtitle={t('franchises.list.subtitle')}
        actions={<Button onClick={() => setCreating(true)}>{t('franchises.list.addButton')}</Button>}
      />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 180 }}>
              <Field label={t('franchises.list.feeModelLabel')} htmlFor="franchises-fee-model-filter">
                <SelectField
                  id="franchises-fee-model-filter"
                  value={feeModelFilter}
                  onChange={(e) => setFeeModelFilter(e.target.value as FeeModel | '')}
                  options={[
                    { value: '', label: t('franchises.list.feeModelAll') },
                    { value: 'FLAT', label: t('franchises.feeModels.flat') },
                    { value: 'PER_HEADCOUNT', label: t('franchises.feeModels.perHeadcount') },
                  ]}
                />
              </Field>
            </div>
            <div style={{ minWidth: 200 }}>
              <Field label={t('franchises.list.activityLabel')} htmlFor="franchises-activity-filter" hint={t('franchises.list.activityHint')}>
                <TextField
                  id="franchises-activity-filter"
                  placeholder={t('franchises.list.activityPlaceholder')}
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('franchises.list.viewAria')} />
        </div>
      </Card>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : t('franchises.list.loadFailed')} />
      ) : (
        <Card>
          {franchises.length === 0 ? (
            <EmptyState
              title={hasFilter ? t('franchises.list.emptyFilteredTitle') : t('franchises.list.emptyTitle')}
              description={hasFilter ? t('franchises.list.emptyFilteredDescription') : t('franchises.list.emptyDescription')}
            />
          ) : viewMode === 'grid' ? (
            <CardGrid>
              {franchises.map((f) => (
                <Card key={f.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/franchises/${f.id}`)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-accent)', cursor: 'pointer', font: 'inherit', textAlign: 'left', fontWeight: 600 }}
                  >
                    {f.name}
                  </button>
                  {f.archivedAt ? (
                    <span style={{ marginLeft: 8 }}>
                      <Badge variant="danger">{t('franchises.list.closed')}</Badge>
                    </span>
                  ) : null}
                  <div style={{ margin: '8px 0' }}>
                    {f.activities.map((a, i) => (
                      <Badge key={`${a}-${i}`}>{a}</Badge>
                    ))}
                  </div>
                  <Badge>{f.feeModel === 'FLAT' ? t('franchises.feeModels.flat') : t('franchises.feeModels.perHeadcount')}</Badge>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <Button variant="secondary" onClick={() => navigate(`/franchises/${f.id}`)}>
                      {t('franchises.list.viewDetails')}
                    </Button>
                    {/* Decision 336 (F8) — a closed Franchise can't be edited. */}
                    {f.archivedAt ? null : (
                      <Button variant="secondary" onClick={() => setEditing(f)}>
                        {t('franchises.list.edit')}
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <Table<FranchiseResponse>
              rows={franchises}
              columns={[
                {
                  key: 'name',
                  header: t('franchises.list.columnName'),
                  // The Name/logo cell itself now navigates too — previously only the
                  // row action menu's "View details" button did (v1.2 backend
                  // backlog, "Franchises page", "Rows-table identity column is
                  // non-clickable").
                  render: (f) => (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => navigate(`/franchises/${f.id}`)}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-accent)', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                      >
                        {f.name}
                      </button>
                      {/* Decision 336 (F8) */}
                      {f.archivedAt ? <Badge variant="danger">{t('franchises.list.closed')}</Badge> : null}
                    </span>
                  ),
                },
                {
                  key: 'activities',
                  header: t('franchises.list.columnActivities'),
                  render: (f) => f.activities.map((a, i) => <Badge key={`${a}-${i}`}>{a}</Badge>),
                },
                { key: 'feeModel', header: t('franchises.list.columnFeeModel'), render: (f) => <Badge>{f.feeModel === 'FLAT' ? t('franchises.feeModels.flat') : t('franchises.feeModels.perHeadcount')}</Badge> },
                {
                  key: 'actions',
                  header: '',
                  render: (f) => (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="secondary" onClick={() => navigate(`/franchises/${f.id}`)}>
                        {t('franchises.list.viewDetails')}
                      </Button>
                      {f.archivedAt ? null : (
                        <Button variant="secondary" onClick={() => setEditing(f)}>
                          {t('franchises.list.edit')}
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {creating ? (
        <FranchiseFormModal
          title={t('franchises.list.addTitle')}
          submitting={createFranchise.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateFranchiseDto doesn't accept null.
            await createFranchise.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? <EditFranchiseModal franchise={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function EditFranchiseModal({ franchise, onClose }: { franchise: FranchiseResponse; onClose: () => void }) {
  const t = useT();
  const updateFranchise = useUpdateFranchise(franchise.id);
  const { data: billingStatus } = useFranchiseBillingStatus(franchise.id);
  return (
    <FranchiseFormModal
      title={t('franchises.list.editTitle')}
      initial={franchise}
      schoolsAlreadyBillingCount={billingStatus?.schoolsAlreadyBillingCount ?? 0}
      submitting={updateFranchise.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateFranchiseDto accepts
        // null on these fields to mean "clear it".
        await updateFranchise.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
