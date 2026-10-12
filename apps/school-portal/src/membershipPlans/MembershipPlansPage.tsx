import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, RowActionsMenu, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useClasses } from '../classes/classQueries';
import { formatMoney } from '../lib/money';
import {
  useActiveMemberTotal,
  useArchiveMembershipPlan,
  useMembershipPlans,
  useUnarchiveMembershipPlan,
  useUpdateMembershipPlanVisibility,
  type MembershipPlanResponse,
} from './membershipPlanQueries';

const TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Subscription',
  CLASS_PACK: 'Class Pack',
  WEEKLY_PASS: 'Weekly Pass',
  FRIEND_PASS: 'Friend Pass',
  TRIAL_MEMBERSHIP: 'Trial Membership',
};

/** Small, page-local summary tile — not promoted to @ultm8/ui since nothing else
 * uses this shape yet. `proposed` renders it visibly inert (dashed border, muted
 * value, an aria-label saying why) rather than omitted — same convention
 * TopBar's disabled search input already established for "not built yet, not
 * broken" (see that component's own header comment). */
function StatTile({ label, value, proposed, note }: { label: string; value: React.ReactNode; proposed?: boolean; note?: string }) {
  return (
    <div
      // Stable Playwright hook — "Archived"/"Visible" etc. as plain text
      // aren't unique on this page by themselves (a Badge reading "Archived"
      // also renders in an archived row, same <span> shape) — a `data-testid`
      // keyed on the label is the robust way to locate one specific tile.
      data-testid={`stat-tile-${label}`}
      aria-label={proposed ? `${label} — ${note}` : undefined}
      title={proposed ? note : undefined}
      style={{
        flex: 1,
        minWidth: 140,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '14px 18px',
        background: 'var(--surface-0)',
        border: `1px ${proposed ? 'dashed' : 'solid'} var(--border-strong)`,
        borderRadius: 'var(--radius-md)',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: 700, color: proposed ? 'var(--text-muted)' : 'var(--text-primary)' }}>{value}</span>
    </div>
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

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Membership Plans.'} />;

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
    <>
      <PageHeader
        title="Membership Plans"
        subtitle="Subscription, Class Pack, Weekly Pass, Friend Pass, and Trial plans Students can purchase."
        actions={<Button onClick={() => navigate('/membership-plans/new')}>Add plan</Button>}
      />

      {/* Stats ribbon (Decision — see POST-SPEC-55-DECISION-LOG.md): Total/Visible/
          Hidden/Archived are real, computed here from the same `plans` list rendered
          below. Active members (v1.2 backend backlog) is now real too — summed across
          every plan's own GET /membership-plans/{id}/active-count (see
          useActiveMemberTotal's own header comment for why it's a fan-out sum, not a
          single bulk endpoint). Archived (v1.2 backend backlog "Archive action") is
          the 4th tile — see activePlans/archivedCount above for why Visible/Hidden
          exclude archived plans rather than double-counting them. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Total plans" value={plans.length} />
        <StatTile label="Visible" value={visibleCount} />
        <StatTile label="Hidden" value={activePlans.length - visibleCount} />
        <StatTile label="Archived" value={archivedCount} />
        <StatTile
          label="Active members"
          value={activeMembers.isLoading ? <Spinner /> : activeMembers.error ? '—' : activeMembers.total}
        />
      </div>

      {toggleError ? <ErrorBanner message={toggleError} /> : null}

      <Card>
        {plans.length === 0 ? (
          <EmptyState title="No Membership Plans yet" description="Add your first plan to get started." />
        ) : (
          <Table<MembershipPlanResponse>
            rows={plans}
            columns={[
              {
                key: 'title',
                header: 'Title',
                render: (p) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.title}
                    {p.archivedAt ? <Badge variant="default">Archived</Badge> : null}
                  </div>
                ),
              },
              { key: 'type', header: 'Type', render: (p) => <Badge variant="accent">{TYPE_LABELS[p.type] ?? p.type}</Badge> },
              { key: 'price', header: 'Price', render: (p) => formatMoney(p.price, p.currency) },
              {
                key: 'scopedClass',
                header: 'Scoped to',
                render: (p) => classes.find((c) => c.id === p.scopedClassId)?.title ?? (p.scopedClassId ? p.scopedClassId : 'Any class'),
              },
              {
                key: 'visible',
                header: 'Visibility',
                render: (p) => (
                  <Checkbox
                    label="Visible"
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
                            setToggleError(err instanceof ApiError ? err.message : 'Could not update visibility — please try again.'),
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
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Button variant="secondary" onClick={() => navigate(`/membership-plans/${p.id}/edit`)}>
                      Edit
                    </Button>
                    {/* v1.2 backend backlog "Archive action" — Archive/Unarchive
                        now lives in the row's own action menu (RowActionsMenu,
                        this app's established dropdown — see ClassesPage's own
                        identical usage), alongside Duplicate, which moves here
                        too so this page has exactly one place for secondary row
                        actions rather than splitting them across a growing row
                        of buttons and a menu. */}
                    <RowActionsMenu
                      label={`Actions for ${p.title}`}
                      actions={[
                        {
                          label: 'Duplicate',
                          onClick: () =>
                            navigate('/membership-plans/new', {
                              state: {
                                duplicateFrom: { ...p, id: undefined, createdAt: undefined, updatedAt: undefined, title: `${p.title} (copy)` },
                              },
                            }),
                        },
                        p.archivedAt
                          ? {
                              label: 'Unarchive',
                              disabled: unarchivePlan.isPending && unarchivePlan.variables === p.id,
                              onClick: () => {
                                setToggleError(null);
                                unarchivePlan.mutate(p.id, {
                                  onError: (err) =>
                                    setToggleError(err instanceof ApiError ? err.message : 'Could not unarchive this plan — please try again.'),
                                });
                              },
                            }
                          : {
                              label: 'Archive',
                              disabled: archivePlan.isPending && archivePlan.variables === p.id,
                              onClick: () => {
                                setToggleError(null);
                                archivePlan.mutate(p.id, {
                                  onError: (err) =>
                                    setToggleError(err instanceof ApiError ? err.message : 'Could not archive this plan — please try again.'),
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
      </Card>
    </>
  );
}
