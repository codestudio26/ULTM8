import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { flattenLadder } from '../grading/ladder';
import { useDeclareMyBelt, useMyBelts, type InstructorBelt } from '../instructors/instructorBeltQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * "My belts" (Decisions 108, 188): an instructor chooses their own belt and
 * stripe in each of the School's styles. It shows "Not verified" until the
 * School Owner verifies it or corrects it; choosing another belt makes it
 * unverified again.
 */
export function MyBeltsPage() {
  const schoolId = useCoachSchoolId();
  const disciplines = useDisciplines(schoolId);
  const mine = useMyBelts(schoolId);

  if (!schoolId) return null;
  if (disciplines.isLoading || mine.isLoading) return <Spinner />;
  if (disciplines.error || mine.error) return <ErrorBanner message={errorText(disciplines.error ?? mine.error, 'Could not load your belts.')} />;
  const styles = disciplines.data?.items ?? [];
  const belts = mine.data?.items ?? [];

  return (
    <>
      <PageHeader title="My belts" subtitle="Your own belt in each style. The School owner verifies it." />
      {styles.length === 0 ? (
        <EmptyState title="No styles yet" description="The School owner hasn't set up any styles." />
      ) : (
        styles.map((style) => <StyleBelt key={style.id} schoolId={schoolId} style={style} current={belts.find((b) => b.disciplineId === style.id) ?? null} />)
      )}
    </>
  );
}

function StyleBelt({ schoolId, style, current }: { schoolId: string; style: DisciplineResponse; current: InstructorBelt | null }) {
  const ranks = useRanks(style.id);
  const declare = useDeclareMyBelt(schoolId);
  const [choice, setChoice] = useState(current?.stripeTierId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const ladder = flattenLadder(ranks.data?.items ?? []);
  const fieldId = `my-belt-${style.id}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const rung = ladder.find((r) => r.id === choice);
    if (!rung) {
      setError('Choose your belt.');
      return;
    }
    try {
      await declare.mutateAsync({ disciplineId: style.id, rankId: rung.rankId, stripeTierId: rung.id });
      setSaved(true);
    } catch (err) {
      setError(errorText(err, 'Could not save your belt.'));
    }
  }

  return (
    <Card className="ultm8-field">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18, margin: 0 }}>
          {style.name}
        </h2>
        {current ? (
          current.verificationStatus === 'VERIFIED' ? <Badge variant="success">Verified</Badge> : <Badge variant="danger">Not verified</Badge>
        ) : null}
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {saved ? <SuccessBanner message="Saved. The School owner will verify it." /> : null}
      {ranks.isLoading ? (
        <Spinner />
      ) : ladder.length === 0 ? (
        <p>This style has no belts yet.</p>
      ) : (
        <form onSubmit={save}>
          <Field label={`Your belt in ${style.name}`} htmlFor={fieldId}>
            <SelectField
              id={fieldId}
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              options={[{ value: '', label: 'Choose your belt…' }, ...ladder.map((r) => ({ value: r.id, label: r.name }))]}
            />
          </Field>
          <Button type="submit" loading={declare.isPending} disabled={!choice || choice === current?.stripeTierId}>
            Save
          </Button>
        </form>
      )}
    </Card>
  );
}
