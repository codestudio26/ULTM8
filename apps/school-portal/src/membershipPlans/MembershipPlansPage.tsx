import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useClasses } from '../classes/classQueries';
import { formatMoney } from '../lib/money';
import { useMembershipPlans, useUpdateMembershipPlanVisibility, type MembershipPlanResponse } from './membershipPlanQueries';

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
  const [toggleError, setToggleError] = useState<string | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Membership Plans.'} />;

  const plans = data?.items ?? [];
  const classes = classData?.items ?? [];
  const visibleCount = plans.filter((p) => p.visible).length;

  return (
    <>
      <PageHeader
        title="Membership Plans"
        subtitle="Subscription, Class Pack, Weekly Pass, Friend Pass, and Trial plans Students can purchase."
        actions={<Button onClick={() => navigate('/membership-plans/new')}>Add plan</Button>}
      />

      {/* Stats ribbon (Decision — see POST-SPEC-55-DECISION-LOG.md): Total/Visible/
          Hidden are real, computed here from the same `plans` list rendered below —
          nothing fabricated. Active members is a proposed placeholder: no per-plan
          membership-count endpoint exists anywhere in MembershipsController (only
          Student-scoped findMyMemberships/getMembershipStatus) — logged as a backend
          backlog item rather than guessed at. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Total plans" value={plans.length} />
        <StatTile label="Visible" value={visibleCount} />
        <StatTile label="Hidden" value={plans.length - visibleCount} />
        <StatTile
          label="Active members"
          value="—"
          proposed
          note="Not available yet — no per-plan membership-count endpoint exists on the backend (see docs/v1.2-backend-backlog.md)."
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
              { key: 'title', header: 'Title', render: (p) => p.title },
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
