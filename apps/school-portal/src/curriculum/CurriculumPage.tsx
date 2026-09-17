import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import {
  useCreateLesson,
  useLessons,
  useSchoolSkillGroups,
  useUpdateLesson,
  type DisciplineSkillGroup,
  type LessonResponse,
} from './curriculumQueries';
import { LessonFormModal } from './LessonFormModal';

/** School-scoped Lesson CRUD (Phase 44's backend, Decision 104 — School-scoped,
 * Instructor/Staff-authored, ordinary tenant routes). No video/captioning UI
 * here on purpose: Decision 101 picked vendors (Cloudflare Stream, AWS
 * Transcribe) but the integration itself isn't built — every Lesson's
 * `captionStatus` is PENDING and `videoRef` is null until that pipeline
 * exists, matching this Lesson's own DTO comments. */
export function CurriculumPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useLessons(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  const { groups: skillGroups, isLoading: skillGroupsLoading, error: skillGroupsError } = useSchoolSkillGroups(schoolId);
  const createLesson = useCreateLesson(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LessonResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading || skillGroupsLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Lessons.'} />;
  if (skillGroupsError) {
    return <ErrorBanner message={skillGroupsError instanceof ApiError ? skillGroupsError.message : 'Could not load Skills.'} />;
  }

  const lessons = data?.items ?? [];
  const instructors = instructorData?.items ?? [];

  return (
    <>
      <PageHeader
        title="Curriculum"
        subtitle="Lessons Instructors and Staff can build here — video upload and auto-captioning aren't wired up yet, so every Lesson stays text-only until that pipeline exists."
        actions={<Button onClick={() => setCreating(true)}>Add lesson</Button>}
      />
      <Card>
        {lessons.length === 0 ? (
          <EmptyState title="No Lessons yet" description="Add your first Lesson to get started." />
        ) : (
          <Table<LessonResponse>
            rows={lessons}
            columns={[
              { key: 'title', header: 'Title', render: (l) => l.title },
              {
                key: 'format',
                header: 'Format',
                render: (l) => <Badge variant={l.format === 'LIVE' ? 'accent' : 'default'}>{l.format === 'LIVE' ? 'Live' : 'Prerecorded'}</Badge>,
              },
              { key: 'category', header: 'Category', render: (l) => l.category ?? '—' },
              { key: 'duration', header: 'Duration', render: (l) => (l.durationSeconds ? `${Math.round(l.durationSeconds / 60)} min` : '—') },
              {
                key: 'instructor',
                header: 'Instructor',
                render: (l) => (l.instructorId ? instructors.find((i) => i.userId === l.instructorId)?.userId ?? l.instructorId : '—'),
              },
              { key: 'skills', header: 'Skills', render: (l) => l.skillIds.length },
              {
                key: 'actions',
                header: '',
                render: (l) => (
                  <Button variant="secondary" onClick={() => setEditing(l)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creating ? (
        <LessonFormModal
          title="Add lesson"
          instructors={instructors}
          skillGroups={skillGroups}
          submitting={createLesson.isPending}
          onSubmit={async (values) => {
            await createLesson.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditLessonModal schoolId={schoolId} instructors={instructors} skillGroups={skillGroups} lesson={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditLessonModal({
  schoolId,
  instructors,
  skillGroups,
  lesson,
  onClose,
}: {
  schoolId: string;
  instructors: InstructorResponse[];
  skillGroups: DisciplineSkillGroup[];
  lesson: LessonResponse;
  onClose: () => void;
}) {
  const updateLesson = useUpdateLesson(schoolId, lesson.id);
  return (
    <LessonFormModal
      title="Edit lesson"
      initial={lesson}
      instructors={instructors}
      skillGroups={skillGroups}
      submitting={updateLesson.isPending}
      onSubmit={async (values) => {
        await updateLesson.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
