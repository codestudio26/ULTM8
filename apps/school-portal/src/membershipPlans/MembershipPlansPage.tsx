import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useClasses, type ClassResponse } from '../classes/classQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { formatMoney } from '../lib/money';
import {
  useCreateMembershipPlan,
  useMembershipPlans,
  useUpdateMembershipPlan,
  type MembershipPlanResponse,
} from './membershipPlanQueries';
import { MembershipPlanFormModal } from './MembershipPlanFormModal';

const TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Subscription',
  CLASS_PACK: 'Class Pack',
  WEEKLY_PASS: 'Weekly Pass',
  FRIEND_PASS: 'Friend Pass',
  TRIAL_MEMBERSHIP: 'Trial Membership',
};

export function MembershipPlansPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useMembershipPlans(schoolId);
  const { data: classData } = useClasses(schoolId);
  const createPlan = useCreateMembershipPlan(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MembershipPlanResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Membership Plans.'} />;

  const plans = data?.items ?? [];
  const classes = classData?.items ?? [];

  return (
    <>
      <PageHeader
        title="Membership Plans"
        subtitle="Subscription, Class Pack, Weekly Pass, Friend Pass, and Trial plans Students can purchase."
        actions={<Button onClick={() => setCreating(true)}>Add plan</Button>}
      />
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
                render: (p) => (p.visible ? <Badge variant="success">Visible</Badge> : <Badge>Hidden</Badge>),
              },
              {
                key: 'actions',
                header: '',
                render: (p) => (
                  <Button variant="secondary" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creating ? (
        <MembershipPlanFormModal
          title="Add membership plan"
          classes={classes}
          submitting={createPlan.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateMembershipPlanDto doesn't
            // accept null on these fields.
            await createPlan.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditMembershipPlanModal schoolId={schoolId} classes={classes} plan={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditMembershipPlanModal({
  schoolId,
  classes,
  plan,
  onClose,
}: {
  schoolId: string;
  classes: ClassResponse[];
  plan: MembershipPlanResponse;
  onClose: () => void;
}) {
  const updatePlan = useUpdateMembershipPlan(schoolId, plan.id);
  return (
    <MembershipPlanFormModal
      title="Edit membership plan"
      initial={plan}
      classes={classes}
      submitting={updatePlan.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateMembershipPlanDto
        // accepts null on these fields to mean "clear it" (see
        // MembershipPlanFormValues' own header comment).
        await updatePlan.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
