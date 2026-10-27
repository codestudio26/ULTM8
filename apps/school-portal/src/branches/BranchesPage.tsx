import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, Checkbox, EmptyState, ErrorBanner, Field, PageHeader, RowActionsMenu, SelectField, Spinner, Table, TextField, ViewToggle, formatTimezone, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { nullsToUndefined } from '../lib/nullableFields';
import { useBranches, useCreateBranch, useUnarchiveBranch, type BranchListItem } from './branchQueries';
import { BranchFormModal } from './BranchFormModal';
import { CloseBranchModal } from './CloseBranchModal';
import { useT } from '../i18n/I18nProvider';
import { countryDisplayName, formatLocale } from '../i18n/format';

/** English shows the stored zone as it always has; another language leads with its own name for it. */
const timezoneLabel = (zone: string) => (formatLocale() ? formatTimezone(zone, formatLocale()) : zone);

/** Case and accents ignored, so "São Paulo" and "Sao Paulo" are one city. */
const cityKey = (city: string) => city.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Decision 294 — the City dropdown's choices, built from the School's own
 * Branches (structured address city only) with how many Branches each has,
 * so nobody has to type a city and nothing can be misspelled. */
function cityOptions(branches: BranchListItem[]): { value: string; label: string }[] {
  const byKey = new Map<string, { city: string; count: number }>();
  for (const b of branches) {
    if (!b.addressCity) continue;
    const key = cityKey(b.addressCity);
    const entry = byKey.get(key);
    if (entry) entry.count += 1;
    else byKey.set(key, { city: b.addressCity, count: 1 });
  }
  return [...byKey.values()]
    .sort((a, b) => a.city.localeCompare(b.city, formatLocale(), { sensitivity: 'base' }))
    .map(({ city, count }) => ({ value: city, label: `${city} (${count})` }));
}

function countryOptions(branches: BranchListItem[]): { value: string; label: string }[] {
  const codes = [...new Set(branches.map((b) => b.addressCountry).filter((c): c is string => !!c))];
  return codes
    .map((code) => ({ value: code, label: countryDisplayName(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, formatLocale(), { sensitivity: 'base' }));
}

export function BranchesPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  // Decision 294 — search (name, city or postcode), a City dropdown and,
  // for a School in more than one country, a Country dropdown. All three
  // filter on the server, ignoring case and accents; the dropdowns' choices
  // come from the School's full, unfiltered Branch list (the same cached
  // list every Branch picker uses).
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  // Rows/Grid is a pure presentation choice over the same fetched data — kept as
  // local, in-memory state (defaulting to "Rows"), not persisted: no school-portal
  // page persists a view/UI preference today (no localStorage usage exists in this
  // app), so there's no existing convention to match, and a per-session default is
  // the documented low-effort choice here.
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const filtering = !!(search.trim() || cityFilter || countryFilter);
  const allBranchesQuery = useBranches(schoolId);
  const { data, isLoading, error } = useBranches(schoolId, { q: search.trim() || undefined, city: cityFilter || undefined, country: countryFilter || undefined });
  const createBranch = useCreateBranch(schoolId ?? '');
  const unarchiveBranch = useUnarchiveBranch(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Decision 226 — archived Branches are excluded by default, same
  // "excluded by default, visible via a filter" convention this build
  // applies to every one of the 7 entities; the full list (including
  // archived) is always fetched (useBranches passes includeArchived: true)
  // so this toggle/count never needs a second request.
  const [showArchived, setShowArchived] = useState(false);
  // Decision 330 — "Close branch" opens a window that shows what is still in
  // use and where it goes (CloseBranchModal), instead of a bare confirmation.
  const [archiving, setArchiving] = useState<BranchListItem | null>(null);

  if (!schoolId) return null;

  const allBranches = data?.items ?? [];
  const archivedCount = allBranches.filter((b) => b.archivedAt).length;
  const branches = showArchived ? allBranches : allBranches.filter((b) => !b.archivedAt);
  const schoolBranches = (allBranchesQuery.data?.items ?? []).filter((b) => showArchived || !b.archivedAt);
  const cities = cityOptions(schoolBranches);
  const countries = countryOptions(schoolBranches);

  return (
    <>
      <PageHeader
        title={t('branches.title')}
        subtitle={t('branches.subtitle')}
        actions={<Button onClick={() => setCreating(true)}>{t('branches.addBranch')}</Button>}
      />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 220 }}>
              <Field label={t('branches.searchLabel')} htmlFor="branches-search">
                <TextField id="branches-search" type="search" placeholder={t('branches.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
            </div>
            <div style={{ minWidth: 180 }}>
              <Field label={t('branches.cityLabel')} htmlFor="branches-city-filter">
                <SelectField value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} options={[{ value: '', label: t('branches.cityAll') }, ...cities]} />
              </Field>
            </div>
            {countries.length > 1 || countryFilter ? (
              <div style={{ minWidth: 180 }}>
                <Field label={t('branches.countryLabel')} htmlFor="branches-country-filter">
                  <SelectField value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} options={[{ value: '', label: t('branches.countryAll') }, ...countries]} />
                </Field>
              </div>
            ) : null}
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
              title={filtering ? t('branches.noMatchTitle') : t('branches.emptyTitle')}
              description={filtering ? t('branches.noMatchDescription') : t('branches.emptyDescription')}
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
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    {t('branches.cardCounts', { students: b.studentCount, classes: b.upcomingClassCount })}
                  </p>
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
                          : { label: t('branches.archive'), onClick: () => { setActionError(null); setArchiving(b); } },
                      ]}
                    />
                  </div>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <Table<BranchListItem>
              rows={branches}
              columns={[
                { key: 'name', header: t('branches.columnName'), render: (b) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{b.name}{b.archivedAt ? <Badge variant="default">{t('branches.archivedBadge')}</Badge> : null}</div>) },
                { key: 'address', header: t('branches.columnAddress'), render: (b) => b.address ?? '—' },
                { key: 'phone', header: t('branches.columnContactPhone'), render: (b) => b.contactPhone ?? '—' },
                { key: 'timezone', header: t('branches.columnTimezone'), render: (b) => (b.timezone ? <Badge>{timezoneLabel(b.timezone)}</Badge> : '—') },
                { key: 'students', header: t('branches.columnStudents'), render: (b) => b.studentCount },
                { key: 'upcomingClasses', header: t('branches.columnUpcomingClasses'), render: (b) => b.upcomingClassCount },
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
                            : { label: t('branches.archive'), onClick: () => { setActionError(null); setArchiving(b); } },
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

      {archiving && schoolId ? (
        <CloseBranchModal branch={archiving} schoolBranches={allBranchesQuery.data?.items ?? []} schoolId={schoolId} onClose={() => setArchiving(null)} />
      ) : null}

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
