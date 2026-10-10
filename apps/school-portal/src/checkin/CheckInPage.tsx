import React, { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, SelectField, Spinner } from '@ultm8/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth, useInstructorSchoolIds } from '../auth/AuthContext';
import { useSchoolNames, useTodaysClassesForInstructor, type ClassResponse } from './checkinQueries';

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

/** Instructor-only Check-in screen (Track B Phase 5) — the display half of
 * self-service QR check-in. The Student's own already-built POST /attendance/scan
 * does all real enforcement (booking ownership, time window, camera consent); this
 * screen's only job is proving the Student is physically here right now, via the
 * rotating nonce above. Deliberately not the Instructor roll-call scan (Decision
 * 71) — that endpoint's mechanics are still undesigned and stay a separate,
 * unbuilt follow-up. */
export function CheckInPage() {
  const { claims } = useAuth();
  const schoolIds = useInstructorSchoolIds();
  const schoolNames = useSchoolNames(schoolIds);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(schoolIds.length === 1 ? schoolIds[0] : null);
  const [selectedClass, setSelectedClass] = useState<ClassResponse | null>(null);

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
              <Button onClick={() => setSelectedClass(classItem)}>Start check-in</Button>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
