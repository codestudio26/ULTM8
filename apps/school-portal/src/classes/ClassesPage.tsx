import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, EmptyState, ErrorBanner, Field, PageHeader, Spinner, Table, TextField, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { useClasses, useCreateClass, useUpdateClass, type ClassResponse } from './classQueries';
import { ClassFormModal } from './ClassFormModal';

export function ClassesPage() {
  const navigate = useNavigate();
  const schoolId = useOwnedSchoolId();
  // Server-side Discipline (Activities) filter + "Search classes" box
  // (GET /schools/:schoolId/classes?activities=&search=), plus Prev/Next cursor
  // pagination (ClassListResponseDto.nextCursor was already real server-side —
  // this page just never wired a pager to it before). A cursor stack (rather than
  // ClassListResponseDto's own forward-only nextCursor) is what makes a real "Prev"
  // possible without re-fetching from page 1 or accumulating every page in memory —
  // no shared Pager component exists yet in this codebase to reuse (confirmed: no
  // other school-portal list page is paginated today), so this is a small, local,
  // one-off control, not a new shared one.
  const [activitiesFilter, setActivitiesFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  // Rows/Grid is a pure presentation choice over the same fetched page of data —
  // kept as local, in-memory state (defaulting to "Rows"), not persisted: no
  // school-portal page persists a view/UI preference today (no localStorage usage
  // exists in this app), so there's no existing convention to match, and a
  // per-session default is the documented low-effort choice here.
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursorStack[pageIndex];

  function resetPaging() {
    setCursorStack([null]);
    setPageIndex(0);
  }

  function goToNextPage(nextCursor: string | null) {
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }

  const { data, isLoading, error } = useClasses(
    schoolId,
    { activities: activitiesFilter.trim() || undefined, search: searchFilter.trim() || undefined },
    cursor,
  );
  const { data: branchData } = useBranches(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  const { data: disciplineData } = useDisciplines(schoolId);
  const createClass = useCreateClass(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClassResponse | null>(null);

  if (!schoolId) return null;

  const classes = data?.items ?? [];
  const branches = branchData?.items ?? [];
  const instructors = instructorData?.items ?? [];
  const disciplines = disciplineData?.items ?? [];
  const hasFilter = activitiesFilter.trim() !== '' || searchFilter.trim() !== '';

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="One-off and recurring Classes Students can book into."
        actions={<Button onClick={() => setCreating(true)}>Add class</Button>}
      />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Discipline" htmlFor="classes-activity-filter" hint="Exact match against one of the Class's Activities.">
                <TextField
                  id="classes-activity-filter"
                  placeholder="e.g. Jiu Jitsu"
                  value={activitiesFilter}
                  onChange={(e) => {
                    setActivitiesFilter(e.target.value);
                    resetPaging();
                  }}
                />
              </Field>
            </div>
            <div style={{ minWidth: 200 }}>
              <Field label="Search classes" htmlFor="classes-search-filter">
                <TextField
                  id="classes-search-filter"
                  type="search"
                  placeholder="Search by title…"
                  value={searchFilter}
                  onChange={(e) => {
                    setSearchFilter(e.target.value);
                    resetPaging();
                  }}
                />
              </Field>
            </div>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} aria-label="Classes view" />
        </div>
      </Card>
      {isLoading ? <Spinner /> : null}
      {error ? <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Classes.'} /> : null}
      {!isLoading && !error ? (
      <Card>
        {classes.length === 0 ? (
          <EmptyState
            title={hasFilter ? 'No Classes match these filters' : 'No Classes yet'}
            description={hasFilter ? 'Try a different discipline or search term, or clear the filters.' : 'Add your first Class to get started.'}
          />
        ) : viewMode === 'grid' ? (
          <CardGrid>
            {classes.map((c) => {
              // Class.instructorId is a direct FK into User (schema.prisma's own
              // comment: "NOT a separate Instructor table"), so the match is on
              // instructor.userId, not instructor.id — same lookup the Rows
              // table's own "Instructor" column uses.
              const instructor = instructors.find((i) => i.userId === c.instructorId);
              const branchName = branches.find((b) => b.id === c.branchId)?.name ?? (c.branchId ? c.branchId : 'Whole School');
              return (
                <Card key={c.id}>
                  <strong>{c.title}</strong>
                  <div style={{ margin: '8px 0' }}>
                    {c.activities.map((a, i) => (
                      <Badge key={`${a}-${i}`}>{a}</Badge>
                    ))}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    {instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : '—'}
                  </p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    {new Date(c.startDate).toLocaleString()} – {new Date(c.endDate).toLocaleString()}
                  </p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>Capacity: {c.capacity ?? 'Unlimited'}</p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{branchName}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <Button variant="secondary" onClick={() => navigate(`/classes/${c.id}`)}>
                      View bookings
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/classes/${c.id}/qr-code`)}>
                      Show QR
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/classes/${c.id}/roll-call`)}>
                      Roll call
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                  </div>
                </Card>
              );
            })}
          </CardGrid>
        ) : (
          <Table<ClassResponse>
            rows={classes}
            columns={[
              { key: 'title', header: 'Title', render: (c) => c.title },
              {
                key: 'activities',
                header: 'Activities',
                // Index-qualified key — activities is unconstrained free text
                // (no dedup enforced), so two identical entries would
                // otherwise collide on the same key.
                render: (c) => c.activities.map((a, i) => <Badge key={`${a}-${i}`}>{a}</Badge>),
              },
              {
                key: 'instructor',
                header: 'Instructor',
                render: (c) => {
                  // Class.instructorId is a direct FK into User (schema.prisma's own
                  // comment: "NOT a separate Instructor table"), so the match is on
                  // instructor.userId, not instructor.id.
                  const instructor = instructors.find((i) => i.userId === c.instructorId);
                  return instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : '—';
                },
              },
              { key: 'start', header: 'Starts', render: (c) => new Date(c.startDate).toLocaleString() },
              { key: 'end', header: 'Ends', render: (c) => new Date(c.endDate).toLocaleString() },
              { key: 'capacity', header: 'Capacity', render: (c) => c.capacity ?? 'Unlimited' },
              {
                key: 'branch',
                header: 'Branch',
                render: (c) => branches.find((b) => b.id === c.branchId)?.name ?? (c.branchId ? c.branchId : 'Whole School'),
              },
              {
                key: 'actions',
                header: '',
                render: (c) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => navigate(`/classes/${c.id}`)}>
                      View bookings
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/classes/${c.id}/qr-code`)}>
                      Show QR
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/classes/${c.id}/roll-call`)}>
                      Roll call
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>
      ) : null}

      {!isLoading && !error && (classes.length > 0 || pageIndex > 0) ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button variant="secondary" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>
            Prev
          </Button>
          <Button variant="secondary" disabled={!data?.nextCursor} onClick={() => goToNextPage(data!.nextCursor ?? null)}>
            Next
          </Button>
          <span className="ultm8-field__hint">Page {pageIndex + 1}</span>
        </div>
      ) : null}

      {creating ? (
        <ClassFormModal
          title="Add class"
          branches={branches}
          instructors={instructors}
          disciplines={disciplines}
          submitting={createClass.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateClassDto doesn't accept null.
            await createClass.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditClassModal
          schoolId={schoolId}
          branches={branches}
          instructors={instructors}
          disciplines={disciplines}
          classItem={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function EditClassModal({
  schoolId,
  branches,
  instructors,
  disciplines,
  classItem,
  onClose,
}: {
  schoolId: string;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  disciplines: DisciplineResponse[];
  classItem: ClassResponse;
  onClose: () => void;
}) {
  const updateClass = useUpdateClass(schoolId, classItem.id);
  return (
    <ClassFormModal
      title="Edit class"
      initial={classItem}
      branches={branches}
      instructors={instructors}
      disciplines={disciplines}
      submitting={updateClass.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateClassDto accepts
        // null on these fields to mean "clear it" (see ClassFormValues' own
        // header comment).
        await updateClass.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
