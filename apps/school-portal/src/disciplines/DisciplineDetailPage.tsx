import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useDiscipline } from './disciplineQueries';
import { useCreateSkill, useSkills, useUpdateSkill, type SkillResponse } from '../skills/skillQueries';
import { SkillFormModal } from '../skills/SkillFormModal';

/** A Discipline's own Skills catalog — Ranks (with their nested stripe-tier
 * ladder) are a real, separate, larger piece of UI (RankStripeTierInputDto's
 * own dynamic array-of-sub-forms shape) deliberately deferred to its own
 * phase rather than folded in here; this page manages Skills only for now.
 * Reached via a "Manage" link from DisciplinesPage's own table — Skill CRUD
 * is nested under a Discipline (`/styles/:disciplineId/skills`), so there's
 * no School-wide Skills list to build a standalone top-level page against. */
export function DisciplineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const disciplineId = id ?? null;
  const { data: discipline, isLoading: disciplineLoading, error: disciplineError } = useDiscipline(disciplineId);
  const { data: skillData, isLoading: skillsLoading, error: skillsError } = useSkills(disciplineId);
  const createSkill = useCreateSkill(disciplineId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SkillResponse | null>(null);

  if (!disciplineId) return null;
  if (disciplineLoading || skillsLoading) return <Spinner />;
  if (disciplineError) {
    return <ErrorBanner message={disciplineError instanceof ApiError ? disciplineError.message : 'Could not load this Discipline.'} />;
  }
  if (skillsError) {
    return <ErrorBanner message={skillsError instanceof ApiError ? skillsError.message : 'Could not load Skills.'} />;
  }

  const skills = skillData?.items ?? [];

  return (
    <>
      <PageHeader
        title={discipline?.name ?? 'Discipline'}
        subtitle={discipline?.classTypesOffered.length ? discipline.classTypesOffered.join(', ') : undefined}
        actions={<Button onClick={() => setCreating(true)}>Add skill</Button>}
      />
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
          Skills
        </h2>
        <p style={{ marginTop: 0, marginBottom: 16 }}>Named Skills a Student can be signed off on within this Discipline.</p>
        {skills.length === 0 ? (
          <EmptyState title="No Skills yet" description="Add your first Skill to get started." />
        ) : (
          <Table<SkillResponse>
            rows={skills}
            columns={[
              { key: 'name', header: 'Name', render: (s) => s.name },
              { key: 'description', header: 'Description', render: (s) => s.description ?? '—' },
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
        )}
      </Card>

      {creating ? (
        <SkillFormModal
          title="Add skill"
          submitting={createSkill.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's null back to
            // undefined (omitted), since CreateSkillDto doesn't accept null.
            await createSkill.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditSkillModal disciplineId={disciplineId} skill={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditSkillModal({ disciplineId, skill, onClose }: { disciplineId: string; skill: SkillResponse; onClose: () => void }) {
  const updateSkill = useUpdateSkill(disciplineId, skill.id);
  return (
    <SkillFormModal
      title="Edit skill"
      initial={skill}
      submitting={updateSkill.isPending}
      onSubmit={async (values) => {
        // Passed straight through, null included — UpdateSkillDto accepts
        // null on description to mean "clear it".
        await updateSkill.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
