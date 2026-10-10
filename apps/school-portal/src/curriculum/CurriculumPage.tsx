import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import {
  useCreateLesson,
  useCreateLessonCategory,
  useLessonCategories,
  useLessons,
  useOrderCategoryLessons,
  useOrderLessonCategories,
  useRenameLessonCategory,
  useSchoolSkillGroups,
  useUpdateLesson,
  type DisciplineSkillGroup,
  type LessonCategory,
  type LessonResponse,
} from './curriculumQueries';
import { LessonFormModal } from './LessonFormModal';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** School-scoped Lesson CRUD (Phase 44's backend, Decision 104 — School-scoped,
 * Instructor/Staff-authored, ordinary tenant routes). No video/captioning UI
 * here on purpose: Decision 101 picked vendors (Cloudflare Stream, AWS
 * Transcribe) but the integration itself isn't built — every Lesson's
 * `captionStatus` is PENDING and `videoRef` is null until that pipeline
 * exists, matching this Lesson's own DTO comments. */
export function CurriculumPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useLessons(schoolId);
  const categoriesQuery = useLessonCategories(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  const { groups: skillGroups, isLoading: skillGroupsLoading, error: skillGroupsError } = useSchoolSkillGroups(schoolId);
  const createLesson = useCreateLesson(schoolId ?? '');
  const orderCategories = useOrderLessonCategories(schoolId ?? '');
  const orderLessons = useOrderCategoryLessons(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LessonResponse | null>(null);
  const [renaming, setRenaming] = useState<LessonCategory | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  if (!schoolId) return null;
  if (isLoading || skillGroupsLoading || categoriesQuery.isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Lessons.'} />;
  if (categoriesQuery.error) return <ErrorBanner message={errorText(categoriesQuery.error, 'Could not load categories.')} />;
  if (skillGroupsError) {
    return <ErrorBanner message={skillGroupsError instanceof ApiError ? skillGroupsError.message : 'Could not load Skills.'} />;
  }

  const lessons = data?.items ?? [];
  const categories = categoriesQuery.data?.items ?? [];
  const instructors = instructorData?.items ?? [];
  const uncategorised = lessons.filter((l) => !l.categoryId);

  async function moveCategory(index: number, delta: number) {
    const ids = categories.map((c) => c.id);
    const j = index + delta;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setMoveError(null);
    try {
      await orderCategories.mutateAsync(ids);
    } catch (err) {
      setMoveError(errorText(err, 'Could not reorder the categories.'));
    }
  }

  async function moveLesson(category: LessonCategory, inCategory: LessonResponse[], index: number, delta: number) {
    const ids = inCategory.map((l) => l.id);
    const j = index + delta;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setMoveError(null);
    try {
      await orderLessons.mutateAsync({ categoryId: category.id, lessonIds: ids });
    } catch (err) {
      setMoveError(errorText(err, 'Could not reorder the lessons.'));
    }
  }

  const lessonColumns = (category: LessonCategory | null, inCategory: LessonResponse[]) => [
    {
      key: 'title',
      header: 'Title',
      render: (l: LessonResponse) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {l.title}
          {l.free ? <Badge variant="success">Free</Badge> : null}
        </span>
      ),
    },
    {
      key: 'format',
      header: 'Format',
      render: (l: LessonResponse) => <Badge variant={l.format === 'LIVE' ? 'accent' : 'default'}>{l.format === 'LIVE' ? 'Live' : 'Prerecorded'}</Badge>,
    },
    { key: 'duration', header: 'Duration', render: (l: LessonResponse) => (l.durationSeconds ? `${Math.round(l.durationSeconds / 60)} min` : '—') },
    {
      key: 'instructor',
      header: 'Instructor',
      render: (l: LessonResponse) => (l.instructorId ? instructors.find((i) => i.userId === l.instructorId)?.userId ?? l.instructorId : '—'),
    },
    { key: 'skills', header: 'Skills', render: (l: LessonResponse) => l.skillIds.length },
    {
      key: 'actions',
      header: '',
      render: (l: LessonResponse) => {
        const i = inCategory.indexOf(l);
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            {category ? (
              <>
                <Button variant="secondary" onClick={() => moveLesson(category, inCategory, i, -1)} disabled={i === 0} aria-label={`Move ${l.title} up`}>
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => moveLesson(category, inCategory, i, 1)}
                  disabled={i === inCategory.length - 1}
                  aria-label={`Move ${l.title} down`}
                >
                  ↓
                </Button>
              </>
            ) : null}
            <Button variant="secondary" onClick={() => setEditing(l)} aria-label={`Edit ${l.title}`}>
              Edit
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Curriculum"
        subtitle="Lessons Instructors and Staff can build here, grouped into categories in the order students see them — video upload and auto-captioning aren't wired up yet, so every Lesson stays text-only until that pipeline exists."
        actions={<Button onClick={() => setCreating(true)}>Add lesson</Button>}
      />
      {moveError ? <ErrorBanner message={moveError} /> : null}
      <CategoriesCard schoolId={schoolId} categories={categories} onMove={moveCategory} onRename={setRenaming} />

      {lessons.length === 0 ? (
        <Card>
          <EmptyState title="No Lessons yet" description="Add your first Lesson to get started." />
        </Card>
      ) : (
        <>
          {categories.map((c) => {
            const inCategory = lessons.filter((l) => l.categoryId === c.id);
            return (
              <Card key={c.id} className="ultm8-field">
                <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
                  {c.name}
                </h2>
                {inCategory.length === 0 ? (
                  <p className="ultm8-field__hint">No lessons in this category yet.</p>
                ) : (
                  <Table<LessonResponse> rows={inCategory} columns={lessonColumns(c, inCategory)} />
                )}
              </Card>
            );
          })}
          {uncategorised.length > 0 ? (
            <Card className="ultm8-field">
              <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
                No category
              </h2>
              <Table<LessonResponse> rows={uncategorised} columns={lessonColumns(null, uncategorised)} />
            </Card>
          ) : null}
        </>
      )}

      {creating ? (
        <LessonFormModal
          title="Add lesson"
          instructors={instructors}
          skillGroups={skillGroups}
          categories={categories}
          submitting={createLesson.isPending}
          onSubmit={async (values) => {
            await createLesson.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditLessonModal
          schoolId={schoolId}
          instructors={instructors}
          skillGroups={skillGroups}
          categories={categories}
          lesson={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {renaming ? <RenameCategoryModal schoolId={schoolId} category={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  );
}

/** The School's categories in order (Decisions 128.15, 191): add, rename,
 * and move up or down. Lessons follow their category's place. */
function CategoriesCard({
  schoolId,
  categories,
  onMove,
  onRename,
}: {
  schoolId: string;
  categories: LessonCategory[];
  onMove: (index: number, delta: number) => void;
  onRename: (c: LessonCategory) => void;
}) {
  const create = useCreateLessonCategory(schoolId);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give this category a name.');
      return;
    }
    try {
      await create.mutateAsync(name.trim());
      setName('');
    } catch (err) {
      setError(errorText(err, 'Could not add the category.'));
    }
  }

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        Categories
      </h2>
      {error ? <ErrorBanner message={error} /> : null}
      {categories.length === 0 ? (
        <p className="ultm8-field__hint">No categories yet. Add one to group your lessons.</p>
      ) : (
        <ol aria-label="Categories" style={{ paddingLeft: 20 }}>
          {categories.map((c, i) => (
            <li key={c.id} aria-label={c.name} style={{ marginBottom: 6 }}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{c.name}</strong>
                <Button variant="secondary" onClick={() => onMove(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`}>
                  ↑
                </Button>
                <Button variant="secondary" onClick={() => onMove(i, 1)} disabled={i === categories.length - 1} aria-label={`Move ${c.name} down`}>
                  ↓
                </Button>
                <Button variant="secondary" onClick={() => onRename(c)} aria-label={`Rename ${c.name}`}>
                  Rename
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="New category" htmlFor="new-lesson-category">
          <TextField id="new-lesson-category" value={name} placeholder="e.g. Escapes" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" loading={create.isPending}>
          Add category
        </Button>
      </form>
    </Card>
  );
}

function RenameCategoryModal({ schoolId, category, onClose }: { schoolId: string; category: LessonCategory; onClose: () => void }) {
  const rename = useRenameLessonCategory(schoolId);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await rename.mutateAsync({ id: category.id, name: name.trim() });
      onClose();
    } catch (err) {
      setError(errorText(err, 'Could not rename the category.'));
    }
  }

  return (
    <Modal title={`Rename ${category.name}`} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <form onSubmit={save}>
        <Field label="Name" htmlFor="rename-lesson-category">
          <TextField id="rename-lesson-category" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={rename.isPending}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditLessonModal({
  schoolId,
  instructors,
  skillGroups,
  categories,
  lesson,
  onClose,
}: {
  schoolId: string;
  instructors: InstructorResponse[];
  skillGroups: DisciplineSkillGroup[];
  categories: LessonCategory[];
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
      categories={categories}
      submitting={updateLesson.isPending}
      onSubmit={async (values) => {
        await updateLesson.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
