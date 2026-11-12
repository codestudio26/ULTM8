import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Checkbox, EmptyState, ErrorBanner, RowActionsMenu, Spinner, Table } from '@ultm8/ui';
import { BillingCard, BillingPage, BillingStat, BillingStats } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useClasses } from '../classes/classQueries';
import { formatMoney } from '../lib/money';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import {
  useActiveMemberTotal,
  useArchiveMembershipPlan,
  useMembershipPlans,
  useUnarchiveMembershipPlan,
  useUpdateMembershipPlanVisibility,
  type MembershipPlanResponse,
} from './membershipPlanQueries';

/** Labels for the `type` enum values, translated at render time — the enum
 * value itself is what the API sends and receives. */
const TYPE_LABELS: Record<string, TranslationKey> = {
  SUBSCRIPTION: 'membershipPlans.types.subscription',
  CLASS_PACK: 'membershipPlans.types.classPack',
  WEEKLY_PASS: 'membershipPlans.types.weeklyPass',
  FRIEND_PASS: 'membershipPlans.types.friendPass',
  TRIAL_MEMBERSHIP: 'membershipPlans.types.trialMembership',
};

/** Shown instead of the page to anyone who doesn't own a School: the API
 * only lets the owner manage plans. In the new look (Decision 453; Decision
 * 460 item 17), on the list, the plan form and a plan's Members page alike. */
export function OwnerOnly() {
  const t = useT();
  return (
    <BillingPage>
      <NewLookPageHeader title={t('membershipPlans.list.title')} />
      <BillingCard>
        <EmptyState title={t('membershipPlans.list.ownerOnlyTitle')} description={t('membershipPlans.list.ownerOnlyDescription')} />
      </BillingCard>
    </BillingPage>
  );
}

export function MembershipPlansPage() {
  const navigate = useNavigate();
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useMembershipPlans(schoolId);
  const { data: classData } = useClasses(schoolId);
  const toggleVisibility = useUpdateMembershipPlanVisibility(schoolId ?? '');
  const archivePlan = useArchiveMembershipPlan(schoolId ?? '');
  const unarchivePlan = useUnarchiveMembershipPlan(schoolId ?? '');
  const [toggleError, setToggleError] = useState<string | null>(null);
  // Hoisted above the early returns below (Rules of Hooks — every hook here
  // must run on every render, loading/error states included) — computed from
  // `data` directly rather than the post-guard `plans` local below.
  const activeMembers = useActiveMemberTotal((data?.items ?? []).map((p) => p.id));
  const t = useT();

  // Memberships review M10 (Decision 334): Branch Staff and coaches reach
  // this page from the menu too; they used to get a blank page.
  if (!schoolId) return <OwnerOnly />;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('membershipPlans.list.loadFailed')} />;

  const plans = data?.items ?? [];
  const classes = classData?.items ?? [];
  // v1.2 backend backlog "Archive action" — Archived is its own tile, counted
  // independently of visible/hidden (archiving doesn't touch the `visible`
  // flag underneath, see MembershipPlan.archivedAt's own schema.prisma
  // comment). Visible/Hidden below are scoped to NON-archived plans only, so
  // an archived-but-still-visible-flagged plan isn't double-counted into
  // both its own Archived tile AND Visible — this ribbon's four tiles are
  // meant to partition the full `plans.length` exactly once each.
  const archivedCount = plans.filter((p) => p.archivedAt).length;
  const activePlans = plans.filter((p) => !p.archivedAt);
  const visibleCount = activePlans.filter((p) => p.visible).length;

  return (
    <BillingPage>
      <NewLookPageHeader
        title={t('membershipPlans.list.title')}
        subtitle={t('membershipPlans.list.subtitle')}
        actions={
          <Button className="u8b-pill u8b-pill--primary" onClick={() => navigate('/membership-plans/new')}>
            {t('membershipPlans.list.addPlan')}
          </Button>
        }
      />

      {/* Stats ribbon (Decision — see POST-SPEC-55-DECISION-LOG.md): Total/Visible/
          Hidden/Archived are real, computed here from the same `plans` list rendered
          below. Active members (v1.2 backend backlog) is now real too — summed across
          every plan's own GET /membership-plans/{id}/active-count (see
          useActiveMemberTotal's own header comment for why it's a fan-out sum, not a
          single bulk endpoint). Archived (v1.2 backend backlog "Archive action") is
          the 4th tile — see activePlans/archivedCount above for why Visible/Hidden
          exclude archived plans rather than double-counting them. A stat row in
          the new look (DESIGN.md → "Stat rows"). The test ids stay keyed on the
          English label, whatever the language. */}
      <BillingCard>
        <BillingStats>
          <BillingStat testId="stat-tile-Total plans" label={t('membershipPlans.list.statTotal')} value={plans.length} />
          <BillingStat testId="stat-tile-Visible" label={t('membershipPlans.list.statVisible')} value={visibleCount} />
          <BillingStat testId="stat-tile-Hidden" label={t('membershipPlans.list.statHidden')} value={activePlans.length - visibleCount} />
          <BillingStat testId="stat-tile-Archived" label={t('membershipPlans.list.statArchived')} value={archivedCount} />
          <BillingStat
            testId="stat-tile-Active members"
            label={t('membershipPlans.list.statActiveMembers')}
            value={activeMembers.isLoading ? <Spinner /> : activeMembers.error ? t('common.none') : activeMembers.total}
          />
        </BillingStats>
      </BillingCard>

      {toggleError ? <ErrorBanner message={toggleError} /> : null}

      <BillingCard flush>
        {plans.length === 0 ? (
          <EmptyState title={t('membershipPlans.list.emptyTitle')} description={t('membershipPlans.list.emptyDescription')} />
        ) : (
          <Table<MembershipPlanResponse>
            rows={plans}
            columns={[
              {
                key: 'title',
                header: t('membershipPlans.list.columnTitle'),
                render: (p) => (
                  <div className="u8b-cell-line">
                    <span className="u8b-name">{p.title}</span>
                    {p.archivedAt ? <Badge variant="default">{t('membershipPlans.list.archivedBadge')}</Badge> : null}
                  </div>
                ),
              },
              {
                key: 'type',
                header: t('membershipPlans.list.columnType'),
                render: (p) => <Badge variant="accent">{TYPE_LABELS[p.type] ? t(TYPE_LABELS[p.type]) : p.type}</Badge>,
              },
              { key: 'price', header: t('membershipPlans.list.columnPrice'), render: (p) => formatMoney(p.price, p.currency) },
              {
                key: 'scopedClass',
                header: t('membershipPlans.list.columnScopedTo'),
                render: (p) => classes.find((c) => c.id === p.scopedClassId)?.title ?? (p.scopedClassId ? p.scopedClassId : t('membershipPlans.list.anyClass')),
              },
              {
                key: 'visible',
                header: t('membershipPlans.list.columnVisibility'),
                render: (p) => (
                  <Checkbox
                    label={t('membershipPlans.list.visibleCheckbox')}
                    checked={p.visible}
                    // v1.2 backend backlog "Archive action" — visibility is moot
                    // once archived (an archived plan never appears in the
                    // Student-facing list regardless of this flag's stored
                    // value, see AcademiesService.findOne's own `where` clause) —
                    // disabled rather than hidden, so the flag's real stored
                    // value is still visible at a glance.
                    disabled={!!p.archivedAt || (toggleVisibility.isPending && toggleVisibility.variables?.id === p.id)}
                    onChange={(e) => {
                      setToggleError(null);
                      toggleVisibility.mutate(
                        { id: p.id, visible: e.target.checked },
                        {
                          onError: (err) =>
                            setToggleError(err instanceof ApiError ? err.message : t('membershipPlans.list.visibilityFailed')),
                        },
                      );
                    }}
                  />
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (p) => (
                  <div className="u8b-row-actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <Button variant="secondary" className="u8b-pill u8b-pill--row" onClick={() => navigate(`/membership-plans/${p.id}/edit`)}>
                      {t('membershipPlans.list.edit')}
                    </Button>
                    {/* v1.2 backend backlog "Archive action" — Archive/Unarchive
                        now lives in the row's own action menu (RowActionsMenu,
                        this app's established dropdown — see ClassesPage's own
                        identical usage), alongside Duplicate, which moves here
                        too so this page has exactly one place for secondary row
                        actions rather than splitting them across a growing row
                        of buttons and a menu. */}
                    <RowActionsMenu
                      label={t('membershipPlans.list.rowActionsAria', { title: p.title })}
                      actions={[
                        // Decision 348: who is on this plan now.
                        { label: t('membershipPlans.list.members'), onClick: () => navigate(`/membership-plans/${p.id}/members`) },
                        {
                          label: t('membershipPlans.list.duplicate'),
                          onClick: () =>
                            navigate('/membership-plans/new', {
                              state: {
                                duplicateFrom: { ...p, id: undefined, createdAt: undefined, updatedAt: undefined, title: t('membershipPlans.list.copyTitle', { title: p.title }) },
                              },
                            }),
                        },
                        p.archivedAt
                          ? {
                              label: t('membershipPlans.list.unarchive'),
                              disabled: unarchivePlan.isPending && unarchivePlan.variables === p.id,
                              onClick: () => {
                                setToggleError(null);
                                unarchivePlan.mutate(p.id, {
                                  onError: (err) =>
                                    setToggleError(err instanceof ApiError ? err.message : t('membershipPlans.list.unarchiveFailed')),
                                });
                              },
                            }
                          : {
                              label: t('membershipPlans.list.archive'),
                              disabled: archivePlan.isPending && archivePlan.variables === p.id,
                              onClick: () => {
                                setToggleError(null);
                                archivePlan.mutate(p.id, {
                                  onError: (err) =>
                                    setToggleError(err instanceof ApiError ? err.message : t('membershipPlans.list.archiveFailed')),
                                });
                              },
                            },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
        )}
      </BillingCard>
    </BillingPage>
  );
}
