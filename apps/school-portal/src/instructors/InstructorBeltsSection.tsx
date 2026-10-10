import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, SelectField, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useRanks } from '../ranks/rankQueries';
import { flattenLadder } from '../grading/ladder';
import { useSchoolInstructorBelts, useVerifyInstructorBelt, type InstructorBelt } from './instructorBeltQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Instructors' belts (Decisions 108, 188): each instructor chooses their own
 * belt per style on their "My belts" page; the owner verifies it here, or
 * corrects it to the right belt.
 */
export function InstructorBeltsSection({ schoolId }: { schoolId: string }) {
  const data = useSchoolInstructorBelts(schoolId);
  const verify = useVerifyInstructorBelt(schoolId);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<InstructorBelt | null>(null);

  const belts = data.data?.items ?? [];
  const waiting = (data.data?.instructors ?? []).filter((i) => !belts.some((b) => b.userId === i.userId));

  async function verifyAsChosen(b: InstructorBelt) {
    setError(null);
    try {
      await verify.mutateAsync({ userId: b.userId, disciplineId: b.disciplineId });
    } catch (err) {
      setError(errorText(err, 'Could not verify this belt.'));
    }
  }

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        Instructors' belts
      </h2>
      <p style={{ marginTop: 0 }}>Instructors choose their own belt in each style. Verify it, or correct it to the right belt.</p>
      {error ? <ErrorBanner message={error} /> : null}
      {data.isLoading ? (
        <Spinner />
      ) : data.error ? (
        <ErrorBanner message={errorText(data.error, 'Could not load instructors\' belts.')} />
      ) : belts.length === 0 ? (
        <EmptyState title="No belts chosen yet" description="Instructors choose theirs on their own My belts page." />
      ) : (
        <Table<InstructorBelt>
          rows={belts}
          columns={[
            { key: 'name', header: 'Instructor', render: (b) => `${b.firstName} ${b.surname}` },
            { key: 'style', header: 'Style', render: (b) => b.disciplineName },
            { key: 'belt', header: 'Belt', render: (b) => b.beltName },
            {
              key: 'status',
              header: 'Status',
              render: (b) => (b.verificationStatus === 'VERIFIED' ? <Badge variant="success">Verified</Badge> : <Badge variant="danger">Not verified</Badge>),
            },
            {
              key: 'actions',
              header: '',
              render: (b) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  {b.verificationStatus === 'UNVERIFIED' ? (
                    <Button variant="secondary" onClick={() => verifyAsChosen(b)} aria-label={`Verify ${b.firstName} ${b.surname}'s ${b.disciplineName} belt`}>
                      Verify
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => setCorrecting(b)} aria-label={`Correct ${b.firstName} ${b.surname}'s ${b.disciplineName} belt`}>
                    Correct
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      {waiting.length > 0 ? (
        <p className="ultm8-field__hint">Not chosen yet: {waiting.map((i) => `${i.firstName} ${i.surname}`).join(', ')}.</p>
      ) : null}
      {correcting ? <CorrectBeltModal schoolId={schoolId} belt={correcting} onClose={() => setCorrecting(null)} /> : null}
    </Card>
  );
}

function CorrectBeltModal({ schoolId, belt, onClose }: { schoolId: string; belt: InstructorBelt; onClose: () => void }) {
  const ranks = useRanks(belt.disciplineId);
  const verify = useVerifyInstructorBelt(schoolId);
  const [choice, setChoice] = useState(belt.stripeTierId);
  const [error, setError] = useState<string | null>(null);
  const ladder = flattenLadder(ranks.data?.items ?? []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const rung = ladder.find((r) => r.id === choice);
    if (!rung) return;
    setError(null);
    try {
      await verify.mutateAsync({ userId: belt.userId, disciplineId: belt.disciplineId, rankId: rung.rankId, stripeTierId: rung.id });
      onClose();
    } catch (err) {
      setError(errorText(err, 'Could not save the belt.'));
    }
  }

  return (
    <Modal title={`${belt.firstName} ${belt.surname}'s ${belt.disciplineName} belt`} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <form onSubmit={save}>
        <Field label="Belt" htmlFor="correct-instructor-belt" hint="Saving verifies it.">
          <SelectField id="correct-instructor-belt" value={choice} onChange={(e) => setChoice(e.target.value)} options={ladder.map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={verify.isPending} disabled={choice === belt.stripeTierId && belt.verificationStatus === 'VERIFIED'}>
            Save and verify
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
