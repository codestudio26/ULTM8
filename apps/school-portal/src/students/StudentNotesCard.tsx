import React, { useState } from 'react';
import { Badge, Button, Checkbox, ErrorBanner, Field, TextArea } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { StudentCard } from './StudentPageLook';
import { useAddStudentNote, useDeleteStudentNote, useEditStudentNote, useStudentNotes, type StudentNote } from './studentNotesQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Staff notes on a student (backlog 3.10; Decision 315 item 8, Decision 400).
 * Any staff who cover the student read them and add new ones; a note's author
 * or a School owner edits or deletes it. "Show to member" puts it in the
 * student's app (a child's Guardian's) and on their check-in card.
 */
export function StudentNotesCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const notes = useStudentNotes(schoolId, studentId);
  const add = useAddStudentNote(schoolId, studentId);
  const [body, setBody] = useState('');
  const [show, setShow] = useState(false);
  if (notes.isError) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    add.mutate({ body: body.trim(), showToMember: show }, { onSuccess: () => { setBody(''); setShow(false); } });
  }

  return (
    <StudentCard title={t('students.notes.title')} testId="student-notes">
      <form onSubmit={submit} style={{ marginBottom: 16 }}>
        {add.error ? <ErrorBanner message={errorText(add.error, t('students.notes.failed'))} /> : null}
        <Field label={t('students.notes.newLabel')} htmlFor="student-note-new">
          <TextArea id="student-note-new" maxLength={2000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="u8sp-line" style={{ justifyContent: 'space-between' }}>
          <Checkbox label={t('students.notes.showToMember')} checked={show} onChange={(e) => setShow(e.target.checked)} />
          <Button type="submit" disabled={!body.trim()} loading={add.isPending}>
            {t('students.notes.add')}
          </Button>
        </div>
      </form>
      {(notes.data?.items ?? []).length === 0 ? (
        <p className="ultm8-field__hint">{t('students.notes.empty')}</p>
      ) : (
        <ul className="u8sp-rows" style={{ marginBottom: -18 }}>
          {(notes.data?.items ?? []).map((n) => (
            <NoteRow key={n.id} note={n} schoolId={schoolId} studentId={studentId} />
          ))}
        </ul>
      )}
    </StudentCard>
  );
}

function NoteRow({ note, schoolId, studentId }: { note: StudentNote; schoolId: string; studentId: string }) {
  const t = useT();
  const edit = useEditStudentNote(schoolId, studentId);
  const remove = useDeleteStudentNote(schoolId, studentId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [show, setShow] = useState(note.showToMember);
  const [confirming, setConfirming] = useState(false);
  const date = new Date(note.createdAt).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const error = edit.error ?? remove.error;

  return (
    <li aria-label={t('students.notes.itemLabel', { author: note.authorName ?? t('students.notes.formerStaff'), date })}>
      <div className="u8sp-line" style={{ marginBottom: 6 }}>
        <strong>{note.authorName ?? t('students.notes.formerStaff')}</strong>
        <span className="u8sp-when">{date}{note.editedAt ? ` · ${t('students.notes.edited')}` : ''}</span>
        <Badge variant={note.showToMember ? 'info' : undefined}>{note.showToMember ? t('students.notes.shown') : t('students.notes.staffOnly')}</Badge>
      </div>
      {error ? <ErrorBanner message={errorText(error, t('students.notes.failed'))} /> : null}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            edit.mutate({ noteId: note.id, body: body.trim(), showToMember: show }, { onSuccess: () => setEditing(false) });
          }}
        >
          <Field label={t('students.notes.editLabel')} htmlFor={`student-note-${note.id}`}>
            <TextArea id={`student-note-${note.id}`} maxLength={2000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="u8sp-line">
            <Checkbox label={t('students.notes.showToMember')} checked={show} onChange={(e) => setShow(e.target.checked)} />
            <Button type="submit" disabled={!body.trim()} loading={edit.isPending}>
              {t('common.save')}
            </Button>
            <Button variant="secondary" type="button" onClick={() => { setEditing(false); setBody(note.body); setShow(note.showToMember); }}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{note.body}</p>
      )}
      {note.canEdit && !editing ? (
        confirming ? (
          <div className="u8sp-line">
            <span>{t('students.notes.confirmDelete')}</span>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(note.id)}>
              {t('students.notes.delete')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <div className="u8sp-line">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('students.notes.edit')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              {t('students.notes.delete')}
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}
