import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useClasses } from '../classes/classQueries';
import { formatMoney } from '../lib/money';
import {
  useActiveMemberTotal,
  useMembershipPlans,
  useUpdateMembershipPlanArchived,
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
  const toggleArchived = useUpdateMembershipPlanArchived(schoolId ?? '');
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // Hoisted above the early returns below (Rules of Hooks — every hook here
  // must run on every render, loading/error states included) — computed from
  // `data` directly rather than the post-guard `plans` local below.
  const activeMembers = useActiveMemberTotal((data?.items ?? []).map((p) => p.id));

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Membership Plans.'} />;

  const plans = data?.items ?? [];
  const classes = classData?.items ?? [];
  const visibleCount = plans.filter((p) => p.visible).length;
  const archivedCount = plans.filter((p) => p.archivedAt).length;
  // v1.2 backend backlog — Archive: dropped from the default list, same
  // client-side-filter convention Visible/Hidden already use, not a new
  // server-side query param.
  const shownPlans = showArchived ? plans : plans.filter((p) => !p.archivedAt);

  return (
    <>
      <PageHeader
        title="Membership Plans"
        subtitle="Subscription, Class Pack, Weekly Pass, Friend Pass, and Trial plans Students can purchase."
        actions={<Button onClick={() => navigate('/membership-plans/new')}>Add plan</Button>}
      />

      {/* Stats ribbon (Decision — see POST-SPEC-55-DECISION-LOG.md): Total/Visible/
          Hidden are real, computed here from the same `plans` list rendered below.
          Active members (v1.2 backend backlog) is now real too — summed across every
          plan's own GET /membership-plans/{id}/active-count (see
          useActiveMemberTotal's own header comment for why it's a fan-out sum, not a
          single bulk endpoint). */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Total plans" value={plans.length} />
        <StatTile label="Visible" value={visibleCount} />
        <StatTile label="Hidden" value={plans.length - visibleCount} />
        <StatTile label="Archived" value={archivedCount} />
        <StatTile
          label="Active members"
          value={activeMembers.isLoading ? <Spinner /> : activeMembers.error ? '—' : activeMembers.total}
        />
      </div>

      {toggleError ? <ErrorBanner message={toggleError} /> : null}

      <Checkbox
        label={`Show archived (${archivedCount})`}
        checked={showArchived}
        onChange={(e) => setShowArchived(e.target.checked)}
      />

      <Card>
        {shownPlans.length === 0 ? (
          <EmptyState
            title={plans.length === 0 ? 'No Membership Plans yet' : 'No plans to show'}
            description={plans.length === 0 ? 'Add your first plan to get started.' : 'Every plan is archived — check "Show archived" above.'}
          />
        ) : (
          <Table<MembershipPlanResponse>
            rows={shownPlans}
            columns={[
              {
                key: 'title',
                header: 'Title',
                render: (p) => (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {p.title}
                    {p.archivedAt ? <Badge>Archived</Badge> : null}
                  </span>
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
                    disabled={toggleVisibility.isPending && toggleVisibility.variables?.id === p.id}
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => navigate(`/membership-plans/${p.id}/edit`)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        navigate('/membership-plans/new', {
                          state: {
                            duplicateFrom: { ...p, id: undefined, createdAt: undefined, updatedAt: undefined, title: `${p.title} (copy)` },
                          },
                        })
                      }
                    >
                      Duplicate
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={toggleArchived.isPending && toggleArchived.variables?.id === p.id}
                      onClick={() => {
                        setToggleError(null);
                        toggleArchived.mutate(
                          { id: p.id, archived: !p.archivedAt },
                          {
                            onError: (err) =>
                              setToggleError(err instanceof ApiError ? err.message : 'Could not update this plan — please try again.'),
                          },
                        );
                      }}
                    >
                      {p.archivedAt ? 'Unarchive' : 'Archive'}
                    </Button>
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
