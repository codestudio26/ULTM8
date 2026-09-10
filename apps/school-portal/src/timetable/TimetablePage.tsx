import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import {
  useCreateTimetableSlot,
  useTimetableSlots,
  useUpdateTimetableSlot,
  type TimetableSlotResponse,
} from './timetableQueries';
import { TimetableSlotFormModal } from './TimetableSlotFormModal';

const WEEKDAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** The recurring weekly TEMPLATE grid — a separate resource from Classes (see
 * TimetableSlotFormModal's own header comment on why this screen doesn't try
 * to reconcile the two). Grouped by weekday since it's a weekly pattern, not
 * a flat list — the one deliberate layout departure from the other CRUD
 * screens in this phase, because a flat table would obscure the thing this
 * screen actually needs to show: what's scheduled on each day. */
export function TimetablePage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useTimetableSlots(schoolId);
  const { data: branchData } = useBranches(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  const createSlot = useCreateTimetableSlot(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TimetableSlotResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load the Timetable.'} />;

  const slots = data?.items ?? [];
  const branches = branchData?.items ?? [];
  const instructors = instructorData?.items ?? [];

  // Recomputed only when `slots` actually changes — not on every render (e.g.
  // toggling the Add/Edit modal open/closed).
  const byWeekday = useMemo(
    () =>
      WEEKDAY_ORDER.map((day) => ({
        day,
        slots: slots.filter((s) => s.weekday === day).sort((a, b) => a.startTime.localeCompare(b.startTime)),
      })),
    [slots],
  );

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle="The recurring weekly slot template — not the bookable Classes list."
        actions={<Button onClick={() => setCreating(true)}>Add slot</Button>}
      />

      {slots.length === 0 ? (
        <Card>
          <EmptyState title="No Timetable slots yet" description="Add your first weekly slot to get started." />
        </Card>
      ) : (
        byWeekday.map(({ day, slots: daySlots }) =>
          daySlots.length === 0 ? null : (
            <Card key={day} className="ultm8-field">
              <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
                {day.charAt(0) + day.slice(1).toLowerCase()}
              </h2>
              <Table<TimetableSlotResponse>
                rows={daySlots}
                columns={[
                  { key: 'time', header: 'Time', render: (s) => `${s.startTime} – ${s.endTime}` },
                  { key: 'title', header: 'Title', render: (s) => s.title },
                  {
                    key: 'activities',
                    header: 'Activities',
                    render: (s) => s.activities.map((a, idx) => <Badge key={`${a}-${idx}`}>{a}</Badge>),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (s) => (s.status === 'ON' ? <Badge variant="success">On</Badge> : <Badge>Off</Badge>),
                  },
                  {
                    key: 'branch',
                    header: 'Branch',
                    render: (s) => branches.find((b) => b.id === s.branchId)?.name ?? (s.branchId ? s.branchId : 'Whole School'),
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (s) => (
                      <Button variant="secondary" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          ),
        )
      )}

      {creating ? (
        <TimetableSlotFormModal
          title="Add timetable slot"
          branches={branches}
          instructors={instructors}
          submitting={createSlot.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateTimetableSlotDto doesn't
            // accept null on these fields.
            await createSlot.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditSlotModal schoolId={schoolId} branches={branches} instructors={instructors} slot={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditSlotModal({
  schoolId,
  branches,
  instructors,
  slot,
  onClose,
}: {
  schoolId: string;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  slot: TimetableSlotResponse;
  onClose: () => void;
}) {
  const updateSlot = useUpdateTimetableSlot(schoolId, slot.id);
  return (
    <TimetableSlotFormModal
      title="Edit timetable slot"
      initial={slot}
      branches={branches}
      instructors={instructors}
      submitting={updateSlot.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateTimetableSlotDto
        // accepts null on these fields to mean "clear it" (see
        // TimetableSlotFormValues' own header comment).
        await updateSlot.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
