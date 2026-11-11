import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorBanner, Spinner, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useCreateFranchise, useFranchiseBillingStatus, useFranchises, useUpdateFranchise, type FeeModel, type FranchiseResponse } from './franchiseQueries';
import { FranchiseFormModal } from './FranchiseFormModal';
import { useT } from '../i18n/I18nProvider';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import '../students/studentsList.css';
import '../organisation/organisationLook.css';

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

  const feeModelTag = (f: FranchiseResponse) => (
    <span className="u8n-tag u8n-tag--inactive">{f.feeModel === 'FLAT' ? t('franchises.feeModels.flat') : t('franchises.feeModels.perHeadcount')}</span>
  );
  const activityTags = (f: FranchiseResponse) =>
    f.activities.length ? (
      <span className="u8o-tags">
        {f.activities.map((a, i) => (
          <span key={`${a}-${i}`} className="u8n-tag u8n-tag--frozen">
            {a}
          </span>
        ))}
      </span>
    ) : null;
  const rowButtons = (f: FranchiseResponse) => (
    <>
      <button type="button" className="u8n-pill u8o-pill--sm" onClick={() => navigate(`/franchises/${f.id}`)}>
        {t('franchises.list.viewDetails')}
      </button>
      {/* Decision 337 (F8) — a closed Franchise can't be edited. */}
      {f.archivedAt ? null : (
        <button type="button" className="u8n-pill u8o-pill--sm" onClick={() => setEditing(f)}>
          {t('franchises.list.edit')}
        </button>
      )}
    </>
  );

  return (
    <div className="u8o">
      <NewLookPageHeader title={t('franchises.list.title')} subtitle={t('franchises.list.subtitle')} />
      <section className="u8n-list" aria-label={t('franchises.list.title')}>
        <div className="u8n-list__toolbar u8o-toolbar">
          <div className="u8n-list__tools">
            <NewLookSelect
              id="franchises-fee-model-filter"
              label={t('franchises.list.feeModelLabel')}
              value={feeModelFilter}
              onChange={(v) => setFeeModelFilter(v as FeeModel | '')}
              options={[
                { value: '', label: t('franchises.list.feeModelAll') },
                { value: 'FLAT', label: t('franchises.feeModels.flat') },
                { value: 'PER_HEADCOUNT', label: t('franchises.feeModels.perHeadcount') },
              ]}
            />
            <div className="u8o-filter">
              <label className="u8o-filter__label" htmlFor="franchises-activity-filter">
                {t('franchises.list.activityLabel')}
              </label>
              <span className="u8n-list__search">
                <input
                  id="franchises-activity-filter"
                  aria-describedby="franchises-activity-hint"
                  placeholder={t('franchises.list.activityPlaceholder')}
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                />
              </span>
            </div>
          </div>
          <div className="u8n-list__tools">
            <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('franchises.list.viewAria')} />
            <button type="button" className="u8n-pill u8n-pill--primary" onClick={() => setCreating(true)}>
              {t('franchises.list.addButton')}
            </button>
          </div>
        </div>
        <p className="u8n-list__hint" id="franchises-activity-hint">
          {t('franchises.list.activityHint')}
        </p>
        {isLoading ? (
          <div className="u8n-list__state">
            <Spinner />
          </div>
        ) : error ? (
          <div className="u8n-list__state">
            <ErrorBanner message={error instanceof ApiError ? error.message : t('franchises.list.loadFailed')} />
          </div>
        ) : franchises.length === 0 ? (
          <div className="u8n-list__state">
            <EmptyState
              title={hasFilter ? t('franchises.list.emptyFilteredTitle') : t('franchises.list.emptyTitle')}
              description={hasFilter ? t('franchises.list.emptyFilteredDescription') : t('franchises.list.emptyDescription')}
            />
          </div>
        ) : viewMode === 'grid' ? (
          <ul className="u8n-grid">
            {franchises.map((f) => (
              <li key={f.id} className="u8n-grid__card">
                <div className="u8o-row" style={{ gap: 8 }}>
                  <button type="button" className="u8o-name" onClick={() => navigate(`/franchises/${f.id}`)}>
                    {f.name}
                  </button>
                  {f.archivedAt ? <span className="u8n-tag u8o-tag--closed">{t('franchises.list.closed')}</span> : null}
                </div>
                <div className="u8o-tags" style={{ margin: '10px 0 0' }}>
                  {activityTags(f)}
                  {feeModelTag(f)}
                </div>
                <div className="u8o-grid-actions">{rowButtons(f)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="u8n-list__scroll">
            <table className="u8n-table">
              <thead>
                <tr>
                  <th scope="col">{t('franchises.list.columnName')}</th>
                  <th scope="col">{t('franchises.list.columnActivities')}</th>
                  <th scope="col">{t('franchises.list.columnFeeModel')}</th>
                  <th scope="col">
                    <span className="u8n-visually-hidden">{t('franchises.list.viewDetails')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {franchises.map((f) => (
                  <tr key={f.id}>
                    {/* The name opens the Franchise too (v1.2 backend backlog,
                        "Franchises page", "Rows-table identity column is
                        non-clickable"). */}
                    <td>
                      <span className="u8o-row" style={{ gap: 8 }}>
                        <button type="button" className="u8o-name" onClick={() => navigate(`/franchises/${f.id}`)}>
                          {f.name}
                        </button>
                        {/* Decision 337 (F8) */}
                        {f.archivedAt ? <span className="u8n-tag u8o-tag--closed">{t('franchises.list.closed')}</span> : null}
                      </span>
                    </td>
                    <td>{activityTags(f)}</td>
                    <td>{feeModelTag(f)}</td>
                    <td>
                      <div className="u8o-actions">{rowButtons(f)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
    </div>
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
