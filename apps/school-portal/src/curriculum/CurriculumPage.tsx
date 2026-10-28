import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import {
  useArchiveLesson,
  useCreateLesson,
  useCreateLessonCategory,
  useDeleteLesson,
  useDeleteLessonCategory,
  useLessonCategories,
  useLessons,
  useOrderCategoryLessons,
  useOrderLessonCategories,
  useRenameLessonCategory,
  useSchoolSkillGroups,
  useUnarchiveLesson,
  useUpdateLesson,
  useVideoUploadStatus,
  type DisciplineSkillGroup,
  type LessonCategory,
  type LessonResponse,
} from './curriculumQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { LessonFormModal } from './LessonFormModal';
import { VideoUploadModal } from './VideoUploadModal';
import { LessonCommentsModal } from './LessonCommentsModal';
import { formatDuration } from './formatDuration';
import { useT, type TranslateFn } from '../i18n/I18nProvider';

/** PENDING gets no badge at all — it's the common case (Decision 101's
 * pipeline was unbuilt until now) and badging every single row would just be
 * noise. PROCESSING/READY/FAILED are the three states a Lesson actually
 * moves through once a video's been uploaded. */
function captionStatusBadge(t: TranslateFn, status: LessonResponse['captionStatus']) {
  switch (status) {
    case 'PROCESSING':
      return <Badge variant="accent">{t('curriculum.videoStatus.processing')}</Badge>;
    case 'READY':
      return <Badge variant="success">{t('curriculum.videoStatus.ready')}</Badge>;
    case 'FAILED':
      return <Badge variant="danger">{t('curriculum.videoStatus.failed')}</Badge>;
    case 'PENDING':
    default:
      return null;
  }
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** School-scoped Lesson CRUD (Phase 44's backend, Decision 104 — School-scoped,
 * Instructor/Staff-authored, ordinary tenant routes). Decision 101's
 * video/captioning pipeline (Cloudflare Stream + AWS Transcribe) is now wired
 * up server-side — see `VideoUploadModal`'s own header comment and
 * `useRequestVideoUploadUrl` in `curriculumQueries.ts`. `LessonFormModal`
 * itself still deliberately has no video fields (its own header comment
 * explains why) — uploading a video is its own dedicated flow, triggered
 * from this page's row actions instead. */
export function CurriculumPage() {
  // Coaches and Branch Staff see the curriculum read-only; only the owner
  // changes it (Decision 326).
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const schoolId = ownedSchoolId ?? coachSchoolId;
  const canEdit = !!ownedSchoolId;
  const { data, isLoading, error } = useLessons(schoolId);
  const categoriesQuery = useLessonCategories(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  const { groups: skillGroups, isLoading: skillGroupsLoading, error: skillGroupsError } = useSchoolSkillGroups(schoolId);
  const createLesson = useCreateLesson(schoolId ?? '');
  const orderCategories = useOrderLessonCategories(schoolId ?? '');
  const orderLessons = useOrderCategoryLessons(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LessonResponse | null>(null);
  const [deleting, setDeleting] = useState<LessonResponse | null>(null);
  const deleteLesson = useDeleteLesson(schoolId ?? '');
  // Decision 226 — reversible alternative to Delete. Shown INLINE (badged),
  // not hidden-by-default the way the other 5 non-ladder entities' list
  // pages are: a category's own "move up/down" reorder sends every lesson
  // already in that category exactly once (orderCategoryLessons' own
  // validation) — hiding an archived lesson from `inCategory` would break
  // that invariant the same way it would for Rank's own ladder reorder
  // (see LadderSection.tsx's identical disclosed deviation). Same "show
  // archived inline, badged" treatment MembershipPlansPage already
  // established.
  const archiveLesson = useArchiveLesson(schoolId ?? '');
  const unarchiveLesson = useUnarchiveLesson(schoolId ?? '');
  const [actionError, setActionError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<LessonCategory | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [uploadingVideoFor, setUploadingVideoFor] = useState<LessonResponse | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [commentsFor, setCommentsFor] = useState<LessonResponse | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<LessonCategory | null>(null);
  const deleteCategory = useDeleteLessonCategory(schoolId ?? '');
  // Off until the video account is set up (C4); unknown counts as on, and the
  // server still refuses with a plain message.
  const videoUploadsOn = useVideoUploadStatus(canEdit ? schoolId : null).data?.enabled ?? true;
  const t = useT();

  if (!schoolId) return null;
  if (isLoading || skillGroupsLoading || categoriesQuery.isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('curriculum.loadFailed')} />;
  if (categoriesQuery.error) return <ErrorBanner message={errorText(categoriesQuery.error, t('curriculum.categoriesLoadFailed'))} />;
  if (skillGroupsError) {
    return <ErrorBanner message={skillGroupsError instanceof ApiError ? skillGroupsError.message : t('curriculum.skillsLoadFailed')} />;
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
      setMoveError(errorText(err, t('curriculum.reorderCategoriesFailed')));
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
      setMoveError(errorText(err, t('curriculum.reorderLessonsFailed')));
    }
  }

  const lessonColumns = (category: LessonCategory | null, inCategory: LessonResponse[]) => [
    {
      key: 'title',
      header: t('curriculum.columnTitle'),
      render: (l: LessonResponse) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {l.title}
          {l.free ? <Badge variant="success">{t('curriculum.free')}</Badge> : null}
          {captionStatusBadge(t, l.captionStatus)}
          {l.archivedAt ? <Badge variant="default">{t('curriculum.archived')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'format',
      header: t('curriculum.columnFormat'),
      render: (l: LessonResponse) => <Badge variant={l.format === 'LIVE' ? 'accent' : 'default'}>{l.format === 'LIVE' ? t('curriculum.formatLive') : t('curriculum.formatPrerecorded')}</Badge>,
    },
    {
      key: 'duration',
      header: t('curriculum.columnDuration'),
      render: (l: LessonResponse) => (l.durationSeconds ? formatDuration(l.durationSeconds) : t('common.none')),
    },
    {
      key: 'instructor',
      header: t('curriculum.columnInstructor'),
      render: (l: LessonResponse) => {
        if (!l.instructorId) return t('common.none');
        const instructor = instructors.find((i) => i.userId === l.instructorId);
        // The coach's name, as the lesson form's own picker shows it; an id only
        // if they're no longer in this School's instructor list.
        return instructor ? `${instructor.firstName} ${instructor.surname}`.trim() || instructor.userId : l.instructorId;
      },
    },
    { key: 'skills', header: t('curriculum.columnSkills'), render: (l: LessonResponse) => l.skillIds.length },
    {
      key: 'actions',
      header: '',
      render: (l: LessonResponse) => {
        const i = inCategory.indexOf(l);
        // Comments panel (Decision 326): an archived lesson's comments stay
        // hidden until it's unarchived.
        const comments = l.archivedAt ? null : (
          <Button variant="secondary" onClick={() => setCommentsFor(l)} aria-label={t('curriculum.comments.openAria', { title: l.title, count: l.commentCount })}>
            {t('curriculum.comments.button', { count: l.commentCount })}
          </Button>
        );
        if (!canEdit) return comments;
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            {comments}
            {category ? (
              <>
                <Button variant="secondary" onClick={() => moveLesson(category, inCategory, i, -1)} disabled={i === 0} aria-label={t('curriculum.moveUpAria', { name: l.title })}>
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => moveLesson(category, inCategory, i, 1)}
                  disabled={i === inCategory.length - 1}
                  aria-label={t('curriculum.moveDownAria', { name: l.title })}
                >
                  ↓
                </Button>
              </>
            ) : null}
            <Button variant="secondary" onClick={() => setEditing(l)} aria-label={t('curriculum.editAria', { name: l.title })}>
              {t('curriculum.edit')}
            </Button>
            {/* Offered while there's no video yet or the last one failed, and
                as "Upload again" while one is processing, in case its upload
                never arrived (C5). Replacing a ready video isn't built. Greyed
                out until video uploads are set up (C4). */}
            {l.captionStatus !== 'READY' ? (
              <Button
                variant="secondary"
                disabled={!videoUploadsOn}
                title={videoUploadsOn ? undefined : t('curriculum.videoUploadsOff')}
                onClick={() => setUploadingVideoFor(l)}
                aria-label={t(l.captionStatus === 'PROCESSING' ? 'curriculum.uploadAgainAria' : 'curriculum.uploadVideoAria', { title: l.title })}
              >
                {t(l.captionStatus === 'PROCESSING' ? 'curriculum.uploadAgain' : 'curriculum.uploadVideo')}
              </Button>
            ) : null}
            {/* Decision 226 — reversible alternative to Delete below, same
                School-Owner gate; no dependents to block it today. */}
            {l.archivedAt ? (
              <Button
                variant="secondary"
                onClick={() => { setActionError(null); unarchiveLesson.mutateAsync(l.id).catch((err) => setActionError(errorText(err, t('curriculum.unarchiveFailed')))); }}
                aria-label={t('curriculum.unarchiveAria', { title: l.title })}
              >
                {t('curriculum.unarchive')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => { setActionError(null); archiveLesson.mutateAsync(l.id).catch((err) => setActionError(errorText(err, t('curriculum.archiveFailed')))); }}
                aria-label={t('curriculum.archiveAria', { title: l.title })}
              >
                {t('curriculum.archive')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDeleting(l)} aria-label={t('curriculum.deleteAria', { title: l.title })}>
              {t('curriculum.delete')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={t('curriculum.title')}
        subtitle={canEdit ? t('curriculum.subtitle') : t('curriculum.readOnlySubtitle')}
        actions={canEdit ? <Button onClick={() => setCreating(true)}>{t('curriculum.addLesson')}</Button> : null}
      />
      {moveError ? <ErrorBanner message={moveError} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {uploadMessage ? <SuccessBanner message={uploadMessage} /> : null}
      {canEdit && !videoUploadsOn ? <p className="ultm8-field__hint">{t('curriculum.videoUploadsOff')}</p> : null}
      {canEdit ? <CategoriesCard schoolId={schoolId} categories={categories} onMove={moveCategory} onRename={setRenaming} onDelete={setDeletingCategory} /> : null}

      {lessons.length === 0 ? (
        <Card>
          <EmptyState title={t('curriculum.emptyTitle')} description={canEdit ? t('curriculum.emptyDescription') : t('curriculum.emptyReadOnly')} />
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
                  <p className="ultm8-field__hint">{t('curriculum.noLessonsInCategory')}</p>
                ) : (
                  <Table<LessonResponse> rows={inCategory} columns={lessonColumns(c, inCategory)} />
                )}
              </Card>
            );
          })}
          {uncategorised.length > 0 ? (
            <Card className="ultm8-field">
              <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
                {t('curriculum.noCategory')}
              </h2>
              {canEdit ? <p className="ultm8-field__hint">{t('curriculum.uncategorisedHint')}</p> : null}
              <Table<LessonResponse> rows={uncategorised} columns={lessonColumns(null, uncategorised)} />
            </Card>
          ) : null}
        </>
      )}

      {creating ? (
        <LessonFormModal
          title={t('curriculum.addLesson')}
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

      {deleting ? (
        <ConfirmDeleteModal
          title={t('curriculum.deleteTitle', { title: deleting.title })}
          description={t('curriculum.deleteDescription')}
          onConfirm={() => deleteLesson.mutateAsync(deleting.id)}
          onClose={() => setDeleting(null)}
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
      {deletingCategory ? (
        <ConfirmDeleteModal
          title={t('curriculum.categories.deleteTitle', { name: deletingCategory.name })}
          description={t('curriculum.categories.deleteDescription', { count: lessons.filter((l) => l.categoryId === deletingCategory.id).length })}
          onConfirm={() => deleteCategory.mutateAsync(deletingCategory.id)}
          onClose={() => setDeletingCategory(null)}
        />
      ) : null}
      {commentsFor ? <LessonCommentsModal schoolId={schoolId} lesson={commentsFor} canDelete={canEdit} onClose={() => setCommentsFor(null)} /> : null}
      {renaming ? <RenameCategoryModal schoolId={schoolId} category={renaming} onClose={() => setRenaming(null)} /> : null}
      {uploadingVideoFor ? (
        <VideoUploadModal
          schoolId={schoolId}
          lesson={uploadingVideoFor}
          onClose={() => setUploadingVideoFor(null)}
          onUploaded={() => {
            setUploadMessage(t('curriculum.uploadingMessage', { title: uploadingVideoFor.title }));
            setUploadingVideoFor(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The School's categories in order (Decisions 128.15, 191): add, rename,
 * move up or down, and delete (Decision 326). Lessons follow their
 * category's place. */
function CategoriesCard({
  schoolId,
  categories,
  onMove,
  onRename,
  onDelete,
}: {
  schoolId: string;
  categories: LessonCategory[];
  onMove: (index: number, delta: number) => void;
  onRename: (c: LessonCategory) => void;
  onDelete: (c: LessonCategory) => void;
}) {
  const create = useCreateLessonCategory(schoolId);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('curriculum.categories.nameRequired'));
      return;
    }
    try {
      await create.mutateAsync(name.trim());
      setName('');
    } catch (err) {
      setError(errorText(err, t('curriculum.categories.addFailed')));
    }
  }

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        {t('curriculum.categories.title')}
      </h2>
      {error ? <ErrorBanner message={error} /> : null}
      {categories.length === 0 ? (
        <p className="ultm8-field__hint">{t('curriculum.categories.empty')}</p>
      ) : (
        <ol aria-label={t('curriculum.categories.title')} style={{ paddingLeft: 20 }}>
          {categories.map((c, i) => (
            <li key={c.id} aria-label={c.name} style={{ marginBottom: 6 }}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{c.name}</strong>
                <Button variant="secondary" onClick={() => onMove(i, -1)} disabled={i === 0} aria-label={t('curriculum.moveUpAria', { name: c.name })}>
                  ↑
                </Button>
                <Button variant="secondary" onClick={() => onMove(i, 1)} disabled={i === categories.length - 1} aria-label={t('curriculum.moveDownAria', { name: c.name })}>
                  ↓
                </Button>
                <Button variant="secondary" onClick={() => onRename(c)} aria-label={t('curriculum.categories.renameAria', { name: c.name })}>
                  {t('curriculum.categories.rename')}
                </Button>
                <Button variant="secondary" onClick={() => onDelete(c)} aria-label={t('curriculum.categories.deleteAria', { name: c.name })}>
                  {t('curriculum.delete')}
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={t('curriculum.categories.newLabel')} htmlFor="new-lesson-category">
          <TextField id="new-lesson-category" value={name} placeholder={t('curriculum.categories.newPlaceholder')} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" loading={create.isPending}>
          {t('curriculum.categories.add')}
        </Button>
      </form>
    </Card>
  );
}

function RenameCategoryModal({ schoolId, category, onClose }: { schoolId: string; category: LessonCategory; onClose: () => void }) {
  const rename = useRenameLessonCategory(schoolId);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await rename.mutateAsync({ id: category.id, name: name.trim() });
      onClose();
    } catch (err) {
      setError(errorText(err, t('curriculum.categories.renameFailed')));
    }
  }

  return (
    <Modal title={t('curriculum.categories.renameAria', { name: category.name })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <form onSubmit={save}>
        <Field label={t('curriculum.categories.nameLabel')} htmlFor="rename-lesson-category">
          <TextField id="rename-lesson-category" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={rename.isPending}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
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
  const t = useT();
  return (
    <LessonFormModal
      title={t('curriculum.editLesson')}
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
