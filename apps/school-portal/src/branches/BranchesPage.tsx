import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, Checkbox, EmptyState, ErrorBanner, Field, PageHeader, RowActionsMenu, Spinner, Table, TextField, ViewToggle, formatTimezone, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { nullsToUndefined } from '../lib/nullableFields';
import { useArchiveBranch, useBranches, useCreateBranch, useUnarchiveBranch, type BranchResponse } from './branchQueries';
import { BranchFormModal } from './BranchFormModal';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

/** English shows the stored zone as it always has; another language leads with its own name for it. */
const timezoneLabel = (zone: string) => (formatLocale() ? formatTimezone(zone, formatLocale()) : zone);

export function BranchesPage() {
  const t = useT();
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
  const archiveBranch = useArchiveBranch(schoolId ?? '');
  const unarchiveBranch = useUnarchiveBranch(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Decision 226 — archived Branches are excluded by default, same
  // "excluded by default, visible via a filter" convention this build
  // applies to every one of the 7 entities; the full list (including
  // archived) is always fetched (useBranches passes includeArchived: true)
  // so this toggle/count never needs a second request.
  const [showArchived, setShowArchived] = useState(false);

  if (!schoolId) return null;

  const allBranches = data?.items ?? [];
  const archivedCount = allBranches.filter((b) => b.archivedAt).length;
  const branches = showArchived ? allBranches : allBranches.filter((b) => !b.archivedAt);

  return (
    <>
      <PageHeader
        title={t('branches.title')}
        subtitle={t('branches.subtitle')}
        actions={<Button onClick={() => setCreating(true)}>{t('branches.addBranch')}</Button>}
      />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Field label={t('branches.cityLabel')} htmlFor="branches-city-filter" hint={t('branches.cityHint')}>
              <TextField
                id="branches-city-filter"
                placeholder={t('branches.cityPlaceholder')}
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {/* Decision 226 — archived Branches are hidden by default. */}
            <Checkbox label={archivedCount ? t('branches.showArchivedCount', { count: archivedCount }) : t('branches.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('branches.viewAria')} />
          </div>
        </div>
      </Card>
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : t('branches.loadFailed')} />
      ) : (
        <Card>
          {branches.length === 0 ? (
            <EmptyState
              title={cityFilter ? t('branches.noMatchTitle') : t('branches.emptyTitle')}
              description={cityFilter ? t('branches.noMatchDescription') : t('branches.emptyDescription')}
            />
          ) : viewMode === 'grid' ? (
            <CardGrid>
              {branches.map((b) => (
                <Card key={b.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <strong>{b.name}</strong>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {b.archivedAt ? <Badge variant="default">{t('branches.archivedBadge')}</Badge> : null}
                      {b.timezone ? <Badge>{timezoneLabel(b.timezone)}</Badge> : null}
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{b.address ?? '—'}</p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{b.contactPhone ?? '—'}</p>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    {/* Decision 231 — a dedicated settings screen replaces the
                        previous edit-via-modal path. */}
                    <Button variant="secondary" onClick={() => navigate(`/branches/${b.id}`)}>
                      {t('branches.settings')}
                    </Button>
                    <RowActionsMenu
                      label={t('branches.rowActionsAria', { name: b.name })}
                      actions={[
                        b.archivedAt
                          ? { label: t('branches.unarchive'), onClick: () => { setActionError(null); unarchiveBranch.mutate(b.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('branches.unarchiveFailed')) }); } }
                          : { label: t('branches.archive'), onClick: () => { setActionError(null); archiveBranch.mutate(b.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('branches.archiveFailed')) }); } },
                      ]}
                    />
                  </div>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <Table<BranchResponse>
              rows={branches}
              columns={[
                { key: 'name', header: t('branches.columnName'), render: (b) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{b.name}{b.archivedAt ? <Badge variant="default">{t('branches.archivedBadge')}</Badge> : null}</div>) },
                { key: 'address', header: t('branches.columnAddress'), render: (b) => b.address ?? '—' },
                { key: 'phone', header: t('branches.columnContactPhone'), render: (b) => b.contactPhone ?? '—' },
                { key: 'timezone', header: t('branches.columnTimezone'), render: (b) => (b.timezone ? <Badge>{timezoneLabel(b.timezone)}</Badge> : '—') },
                {
                  key: 'actions',
                  header: '',
                  render: (b) => (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {/* Decision 231 — a dedicated settings screen replaces the
                          previous edit-via-modal path. */}
                      <Button variant="secondary" onClick={() => navigate(`/branches/${b.id}`)}>
                        {t('branches.settings')}
                      </Button>
                      <RowActionsMenu
                        label={t('branches.rowActionsAria', { name: b.name })}
                        actions={[
                          b.archivedAt
                            ? { label: t('branches.unarchive'), onClick: () => { setActionError(null); unarchiveBranch.mutate(b.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('branches.unarchiveFailed')) }); } }
                            : { label: t('branches.archive'), onClick: () => { setActionError(null); archiveBranch.mutate(b.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('branches.archiveFailed')) }); } },
                        ]}
                      />
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {creating ? (
        <BranchFormModal
          title={t('branches.addBranch')}
          schoolId={schoolId}
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
