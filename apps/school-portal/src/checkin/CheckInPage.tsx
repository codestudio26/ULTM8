import React, { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, SelectField, Spinner } from '@ultm8/ui';
import { QRCodeSVG } from 'qrcode.react';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useInstructorSchoolIds } from '../auth/AuthContext';
import {
  useClassRoster,
  useInstructorCheckIn,
  useSchoolNames,
  useTodaysClassesForInstructor,
  useUndoInstructorCheckIn,
  type ClassResponse,
} from './checkinQueries';

/** How often the displayed code's nonce rotates. The nonce is never sent to or
 * validated by the backend (POST /attendance/scan only ever sees the Student's own
 * bookingId, confirmed in AttendanceService) — it exists purely so the Student app's
 * own freshness check (see apps/student's CheckInScreen) treats a screenshot of this
 * screen as stale within seconds, per SKILL.md §12's binding "time-boxed, rotating,
 * never a single static code" constraint. */
const ROTATE_INTERVAL_MS = 20_000;

function QrDisplay({ classItem, onDone }: { classItem: ClassResponse; onDone: () => void }) {
  const [payload, setPayload] = useState(() => ({ classId: classItem.id, nonce: crypto.randomUUID(), issuedAt: new Date().toISOString() }));

  useEffect(() => {
    const interval = setInterval(() => {
      setPayload({ classId: classItem.id, nonce: crypto.randomUUID(), issuedAt: new Date().toISOString() });
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [classItem.id]);

  return (
    <Card>
      <h2 className="ultm8-page-header__title">{classItem.title}</h2>
      <p>Have each Student scan this with the "Check in" screen in their own app.</p>
      <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
        <QRCodeSVG value={JSON.stringify(payload)} size={320} level="M" marginSize={4} />
      </div>
      <p style={{ textAlign: 'center' }}>This code refreshes automatically — keep this screen open and visible.</p>
      <Button variant="secondary" fullWidth onClick={onDone}>
        Done
      </Button>
    </Card>
  );
}

/** Instructor roll-call screen (Decision 71, Phase 17) — a plain per-Student
 * checklist, not a QR display: resolved with the product owner that the
 * Instructor taps each Student present rather than scanning anything, which
 * also closes the accessibility/no-alternative gap self-service QR check-in
 * has no answer for (no Student camera or device involved either way). Each
 * row is independently tappable — checking one Student in doesn't block
 * tapping the next; `useInstructorCheckIn`/`useUndoInstructorCheckIn` each
 * invalidate the roster query on success, so the list re-reflects the real
 * server state rather than an optimistic local guess. */
function RollCallRoster({ classItem, onDone }: { classItem: ClassResponse; onDone: () => void }) {
  const roster = useClassRoster(classItem.id);
  const checkIn = useInstructorCheckIn(classItem.id);
  const undoCheckIn = useUndoInstructorCheckIn(classItem.id);
  const [actionError, setActionError] = useState<string | null>(null);
  // Tracks which single row has a mutation in flight — disables just that row's
  // own button rather than the whole list, so rolling through a long roster one
  // tap at a time isn't blocked by the previous tap's own round-trip.
  const [pendingStudentId, setPendingStudentId] = useState<string | null>(null);

  async function handleToggle(studentId: string, isPresent: boolean) {
    setActionError(null);
    setPendingStudentId(studentId);
    try {
      if (isPresent) {
        await undoCheckIn.mutateAsync(studentId);
      } else {
        await checkIn.mutateAsync(studentId);
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setPendingStudentId(null);
    }
  }

  return (
    <Card>
      <h2 className="ultm8-page-header__title">{classItem.title}</h2>
      <p>Tap each Student as they arrive. Tap again to undo a mistake.</p>
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {roster.isLoading ? (
        <Spinner />
      ) : roster.isError ? (
        <ErrorBanner message={roster.error instanceof ApiError ? roster.error.message : 'Failed to load the roster — please try again.'} />
      ) : roster.data!.items.length === 0 ? (
        <EmptyState title="No Students booked" description="Nobody is booked into this Class." />
      ) : (
        roster.data!.items.map((entry) => {
          const isPresent = entry.status === 'COMPLETED';
          // A self-service check-in (checkedInById null on a Completed row) isn't
          // undoable from here — see AttendanceService.undoInstructorCheckIn's own
          // comment for why that's scoped to only what THIS roster mechanism set.
          const isUndoable = isPresent && entry.checkedInById !== null;
          const isPending = pendingStudentId === entry.studentId;
          return (
            <div
              key={entry.bookingId}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}
            >
              <div>
                <div>{entry.studentName}</div>
                {isPresent && !isUndoable ? (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Present (self check-in)</div>
                ) : null}
              </div>
              {isPresent ? (
                <Button
                  variant="secondary"
                  onClick={() => handleToggle(entry.studentId, true)}
                  disabled={!isUndoable || isPending}
                  loading={isPending}
                >
                  Present ✓
                </Button>
              ) : (
                <Button onClick={() => handleToggle(entry.studentId, false)} loading={isPending} disabled={isPending}>
                  Mark present
                </Button>
              )}
            </div>
          );
        })
      )}
      <Button variant="secondary" fullWidth onClick={onDone} style={{ marginTop: 16 }}>
        Done
      </Button>
    </Card>
  );
}

/** Instructor-only Check-in screen (Track B Phase 5) — the display half of
 * self-service QR check-in. The Student's own already-built POST /attendance/scan
 * does all real enforcement (booking ownership, time window, camera consent); this
 * screen's only job is proving the Student is physically here right now, via the
 * rotating nonce above.
 *
 * Phase 17 added the second mode: the Instructor roll-call roster
 * (RollCallRoster above) — Decision 71's named concept, resolved with the
 * product owner as a plain per-Student checklist rather than a second scan
 * mechanism. Both modes coexist per-Class: an Instructor picks whichever suits
 * the moment (QR for Students who have their phone in hand, roll-call for
 * anyone who doesn't, or as the accessibility fallback self-service has no
 * answer for). */
export function CheckInPage() {
  const { claims } = useAuth();
  const schoolIds = useInstructorSchoolIds();
  const schoolNames = useSchoolNames(schoolIds);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(schoolIds.length === 1 ? schoolIds[0] : null);
  const [selectedClass, setSelectedClass] = useState<ClassResponse | null>(null);
  const [rollCallClass, setRollCallClass] = useState<ClassResponse | null>(null);

  const { data, isLoading, isError, error } = useTodaysClassesForInstructor(selectedSchoolId, claims?.sub ?? null);

  if (schoolIds.length === 0) return null;

  if (selectedClass) {
    return (
      <>
        <PageHeader title="Check-in" />
        <QrDisplay classItem={selectedClass} onDone={() => setSelectedClass(null)} />
      </>
    );
  }

  if (rollCallClass) {
    return (
      <>
        <PageHeader title="Roll call" />
        <RollCallRoster classItem={rollCallClass} onDone={() => setRollCallClass(null)} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Check-in" subtitle="Pick today's Class to display its check-in code." />

      {schoolIds.length > 1 ? (
        <Card className="ultm8-field">
          <SelectField
            value={selectedSchoolId ?? ''}
            onChange={(e) => setSelectedSchoolId(e.target.value || null)}
            options={[{ value: '', label: 'Select a School…' }, ...schoolIds.map((id) => ({ value: id, label: schoolNames.get(id) ?? id }))]}
          />
        </Card>
      ) : null}

      {!selectedSchoolId ? null : isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorBanner message={error instanceof Error ? error.message : 'Failed to load today’s Classes — please try again.'} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No Classes today" description="You have no Classes scheduled for today at this School." />
      ) : (
        <Card>
          {data.items.map((classItem) => (
            <div
              key={classItem.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}
            >
              <div>
                <div>{classItem.title}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                  {new Date(classItem.startDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} –{' '}
                  {new Date(classItem.endDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => setRollCallClass(classItem)}>
                  Roll call
                </Button>
                <Button onClick={() => setSelectedClass(classItem)}>Start check-in</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
