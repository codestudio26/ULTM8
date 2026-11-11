import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorBanner, RowActionsMenu, Spinner, ViewToggle, formatTimezone, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { foldForSearch, localizeAddressCountry } from '@ultm8/i18n';
import { useAuth, useOwnedSchoolId } from '../auth/AuthContext';
import { nullsToUndefined } from '../lib/nullableFields';
import { useBranches, useCreateBranch, useUnarchiveBranch, type BranchListItem } from './branchQueries';
import { BranchFormModal } from './BranchFormModal';
import { CloseBranchModal } from './CloseBranchModal';
import { useT } from '../i18n/I18nProvider';
import { countryDisplayName, formatLocale } from '../i18n/format';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import '../students/studentsList.css';
import '../organisation/organisationLook.css';

/** English shows the stored zone as it always has; another language leads with its own name for it. */
const timezoneLabel = (zone: string) => (formatLocale() ? formatTimezone(zone, formatLocale()) : zone);

/** Case, accents and spelling variants ignored, so "São Paulo" and "Sao Paulo"
 * are one city: the API's own search fold (Decision 434, TXT-1). */
const cityKey = (city: string) => foldForSearch(city);

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
  const knownUser = !!useAuth().claims;
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

  // Coaches review CP5: owner-only — anyone else goes back to their own home
  // page. Not while the session can't be read yet (a token being refreshed):
  // then nobody is known to own anything, and the page waits instead.
  if (!schoolId) return knownUser ? <Navigate to="/" replace /> : null;

  const allBranches = data?.items ?? [];
  const archivedCount = allBranches.filter((b) => b.archivedAt).length;
  const branches = showArchived ? allBranches : allBranches.filter((b) => !b.archivedAt);
  const schoolBranches = (allBranchesQuery.data?.items ?? []).filter((b) => showArchived || !b.archivedAt);
  const cities = cityOptions(schoolBranches);
  const countries = countryOptions(schoolBranches);

  const rowActions = (b: BranchListItem) => (
    <RowActionsMenu
      label={t('branches.rowActionsAria', { name: b.name })}
      actions={[
        b.archivedAt
          ? { label: t('branches.unarchive'), onClick: () => { setActionError(null); unarchiveBranch.mutate(b.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('branches.unarchiveFailed')) }); } }
          : { label: t('branches.archive'), onClick: () => { setActionError(null); setArchiving(b); } },
      ]}
    />
  );
  // Decision 231 — a dedicated settings screen replaces the previous
  // edit-via-modal path.
  const settingsButton = (b: BranchListItem) => (
    <button type="button" className="u8n-pill u8o-pill--sm" onClick={() => navigate(`/branches/${b.id}`)}>
      {t('branches.settings')}
    </button>
  );
  const address = (b: BranchListItem) => localizeAddressCountry(b.address, formatLocale(), b.addressCountry) ?? '—';

  return (
    <div className="u8o">
      <NewLookPageHeader title={t('branches.title')} subtitle={t('branches.subtitle')} />
      {actionError ? <ErrorBanner message={actionError} /> : null}
      <section className="u8n-list" aria-label={t('branches.title')}>
        <div className="u8n-list__toolbar u8o-toolbar">
          <div className="u8n-list__tools">
            <label className="u8n-list__search" htmlFor="branches-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <span className="u8n-visually-hidden">{t('branches.searchLabel')}</span>
              <input id="branches-search" type="search" placeholder={t('branches.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <NewLookSelect id="branches-city-filter" label={t('branches.cityLabel')} value={cityFilter} onChange={setCityFilter} options={[{ value: '', label: t('branches.cityAll') }, ...cities]} />
            {countries.length > 1 || countryFilter ? (
              <NewLookSelect
                id="branches-country-filter"
                label={t('branches.countryLabel')}
                value={countryFilter}
                onChange={setCountryFilter}
                options={[{ value: '', label: t('branches.countryAll') }, ...countries]}
              />
            ) : null}
          </div>
          <div className="u8n-list__tools">
            <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('branches.viewAria')} />
            <button type="button" className="u8n-pill u8n-pill--primary" onClick={() => setCreating(true)}>
              {t('branches.addBranch')}
            </button>
          </div>
        </div>
        <div className="u8n-list__chips">
          {/* Decision 226 — archived Branches are hidden by default. */}
          <button type="button" className="u8n-chip" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {archivedCount ? t('branches.showArchivedCount', { count: archivedCount }) : t('branches.showArchived')}
          </button>
        </div>
        {isLoading ? (
          <div className="u8n-list__state">
            <Spinner />
          </div>
        ) : error ? (
          <div className="u8n-list__state">
            <ErrorBanner message={error instanceof ApiError ? error.message : t('branches.loadFailed')} />
          </div>
        ) : branches.length === 0 ? (
          <div className="u8n-list__state">
            <EmptyState
              title={filtering ? t('branches.noMatchTitle') : t('branches.emptyTitle')}
              description={filtering ? t('branches.noMatchDescription') : t('branches.emptyDescription')}
            />
          </div>
        ) : viewMode === 'grid' ? (
          <ul className="u8n-grid">
            {branches.map((b) => (
              <li key={b.id} className="u8n-grid__card">
                <div className="u8o-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <strong className="u8n-grid__name">{b.name}</strong>
                  <span className="u8o-tags">
                    {b.archivedAt ? <span className="u8n-tag u8n-tag--inactive">{t('branches.archivedBadge')}</span> : null}
                    {b.timezone ? <span className="u8n-tag u8n-tag--inactive">{timezoneLabel(b.timezone)}</span> : null}
                  </span>
                </div>
                <p>{address(b)}</p>
                <p>{b.contactPhone ?? '—'}</p>
                <p>{t('branches.cardCounts', { students: b.studentCount, classes: b.upcomingClassCount })}</p>
                <div className="u8o-grid-actions">
                  {settingsButton(b)}
                  {rowActions(b)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="u8n-list__scroll">
            <table className="u8n-table">
              <thead>
                <tr>
                  <th scope="col">{t('branches.columnName')}</th>
                  <th scope="col">{t('branches.columnAddress')}</th>
                  <th scope="col">{t('branches.columnContactPhone')}</th>
                  <th scope="col">{t('branches.columnTimezone')}</th>
                  <th scope="col" className="u8o-num">{t('branches.columnStudents')}</th>
                  <th scope="col" className="u8o-num">{t('branches.columnUpcomingClasses')}</th>
                  <th scope="col">
                    <span className="u8n-visually-hidden">{t('branches.settings')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="u8o-row u8o-rowname" style={{ gap: 8 }}>
                        {b.name}
                        {b.archivedAt ? <span className="u8n-tag u8n-tag--inactive">{t('branches.archivedBadge')}</span> : null}
                      </div>
                    </td>
                    <td>{address(b)}</td>
                    <td>{b.contactPhone ?? '—'}</td>
                    <td>{b.timezone ? <span className="u8n-tag u8n-tag--inactive">{timezoneLabel(b.timezone)}</span> : '—'}</td>
                    <td className="u8o-num">{b.studentCount}</td>
                    <td className="u8o-num">{b.upcomingClassCount}</td>
                    <td>
                      <div className="u8o-actions">
                        {settingsButton(b)}
                        {rowActions(b)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
    </div>
  );
}
