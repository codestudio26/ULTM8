import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { BeltChip } from './BeltChip';
import type { Rung } from './ladder';
import { type BulkPromoteResult, type BulkPromoteStudent, type GradingBoardItem, useBulkPromote } from './gradingQueries';

const fullName = (i: { firstName: string; surname: string }) => `${i.firstName} ${i.surname}`.trim();

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface ReportRow {
  name: string;
  from: string;
  to: string;
}

/**
 * Promote the ticked students one rank each (Decision 130; prototype
 * BulkPromoteModal): set the calling order (drag, or the Up/Down buttons), one
 * date and one note. The API checks every student first (a dry run) and the
 * window shows three groups: ready; "Needs a look" (skills not signed off or
 * days short, with the reason) — promoted only with one tick acknowledging
 * them, or remove them; and can't be promoted, which are skipped. Afterwards a
 * printable report lists the promotions in calling order.
 */
export function BulkPromoteModal({
  schoolId,
  style,
  ladder,
  students,
  onRemove,
  onDone,
  onClose,
}: {
  schoolId: string;
  style: DisciplineResponse;
  ladder: Rung[];
  students: GradingBoardItem[];
  onRemove: (studentId: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const bulk = useBulkPromote(schoolId);
  const [order, setOrder] = useState<string[]>(() => students.map((s) => s.studentId));
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [check, setCheck] = useState<BulkPromoteResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ rows: ReportRow[]; skipped: Array<{ name: string; reasons: string[] }>; date: string } | null>(null);
  const dragId = useRef<string | null>(null);

  const byId = (id: string) => students.find((s) => s.studentId === id);
  const rung = (id: string | null | undefined) => ladder.find((r) => r.id === id) ?? null;
  const checkKey = `${[...order].sort().join(',')}|${date}`;

  // Re-check whenever who is in the batch, or the date, changes.
  useEffect(() => {
    if (report || order.length === 0) return;
    let cancelled = false;
    setChecking(true);
    setError(null);
    bulk
      .mutateAsync({ disciplineId: style.id, studentIds: order, dryRun: true, ...(date && date !== todayLocal() ? { effectiveDate: date } : {}) })
      .then((r) => {
        if (!cancelled) setCheck(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setCheck(null);
          setError(err instanceof ApiError ? err.message : 'Could not check these students — please try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey, report]);

  const needsLook = check?.needsAcknowledgement ?? [];
  const cannot = check?.cannotPromote ?? [];
  const flagged = (id: string) => needsLook.find((n) => n.studentId === id);
  const blocked = (id: string) => cannot.find((n) => n.studentId === id);
  const toPromote = order.filter((id) => !blocked(id));

  function remove(id: string) {
    setOrder((o) => o.filter((x) => x !== id));
    onRemove(id);
  }

  function moveBy(id: string, delta: number) {
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function dropOn(targetId: string) {
    const id = dragId.current;
    dragId.current = null;
    if (!id || id === targetId) return;
    setOrder((o) => {
      const next = o.filter((x) => x !== id);
      next.splice(next.indexOf(targetId), 0, id);
      return next;
    });
  }

  async function confirm() {
    setError(null);
    try {
      const effective = date && date !== todayLocal() ? date : undefined;
      const result = await bulk.mutateAsync({
        disciplineId: style.id,
        studentIds: toPromote,
        ...(effective ? { effectiveDate: effective } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(needsLook.length > 0 ? { acknowledgedStudentIds: needsLook.map((n) => n.studentId) } : {}),
      });
      // The report follows the calling order.
      const rows = toPromote
        .map((id) => result.ready.find((r) => r.studentId === id))
        .filter((r): r is BulkPromoteStudent => !!r)
        .map((r) => ({
          name: fullName(byId(r.studentId) ?? { firstName: 'Student', surname: '' }),
          from: rung(r.fromRungId)?.name ?? '—',
          to: rung(r.toRungId)?.name ?? '—',
        }));
      setReport({
        rows,
        // Names now: the board's selection is cleared once the batch is done.
        skipped: [...cannot, ...result.cannotPromote.filter((c) => !cannot.some((x) => x.studentId === c.studentId))].map((c) => ({
          name: fullName(byId(c.studentId) ?? { firstName: 'Student', surname: '' }),
          reasons: c.reasons,
        })),
        date: effective ?? todayLocal(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  function openReport() {
    if (!report) return;
    const html = promotionReportHtml(style.name, note.trim(), report.date, report.rows);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
  }

  if (report) {
    return (
      <Modal title="Students promoted" onClose={onClose}>
        <p>
          You promoted {report.rows.length} student{report.rows.length === 1 ? '' : 's'}.
        </p>
        <ol style={{ paddingLeft: 20 }}>
          {report.rows.map((r, i) => (
            <li key={i}>
              {r.name}: {r.from} → {r.to}
            </li>
          ))}
        </ol>
        {report.skipped.length > 0 ? (
          <ErrorBanner
            message={`Not promoted: ${report.skipped.map((s) => `${s.name} (${s.reasons.join('; ')})`).join(', ')}.`}
          />
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={openReport} disabled={report.rows.length === 0}>
            Open printable report
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  const needsAck = needsLook.length > 0;
  return (
    <Modal title="Promote these students" onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
        Each student moves up one rank. Set the calling order by dragging a row, or with Up and Down.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 160 }}>
          <Field label="Grading date" htmlFor="bulk-date" hint="Empty for today. It must suit every student.">
            <TextField type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field label="Note" htmlFor="bulk-note" hint='Optional, e.g. "Spring Grading Day".'>
            <TextField maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      {order.length === 0 ? (
        <p>Nothing selected.</p>
      ) : (
        <ol aria-label="Calling order" style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 6, maxHeight: '45vh', overflow: 'auto' }}>
          {order.map((id, i) => {
            const s = byId(id);
            if (!s) return null;
            const name = fullName(s);
            const from = rung(s.currentStripeId);
            const to = rung(s.eligibility.nextRungId);
            const flag = flagged(id);
            const skip = blocked(id);
            return (
              <li
                key={id}
                draggable
                onDragStart={() => (dragId.current = id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(id);
                }}
                aria-label={`${i + 1}. ${name}`}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  cursor: 'grab',
                  opacity: skip ? 0.6 : 1,
                }}
              >
                <span style={{ width: 20, color: 'var(--text-secondary)' }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 120 }}>
                  <strong>{name}</strong>
                  {flag ? <div style={{ color: 'var(--text-warning)', fontSize: 12 }}>Needs a look: {flag.reasons.join('; ')}</div> : null}
                  {skip ? <div style={{ color: 'var(--text-danger)', fontSize: 12 }}>Can't be promoted: {skip.reasons.join('; ')}</div> : null}
                </span>
                {from ? <BeltChip rung={from} /> : null}
                <span aria-hidden="true">→</span>
                {to ? <BeltChip rung={to} /> : null}
                <span className="ultm8-field__hint" style={{ minWidth: 70 }}>
                  {to?.name}
                </span>
                <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
                  <Button type="button" variant="secondary" onClick={() => moveBy(id, -1)} disabled={i === 0} aria-label={`Move ${name} up`}>
                    ↑
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => moveBy(id, 1)} disabled={i === order.length - 1} aria-label={`Move ${name} down`}>
                    ↓
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => remove(id)} aria-label={`Remove ${name} from this batch`}>
                    ✕
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {checking ? <Spinner /> : null}
      {needsAck ? (
        <Checkbox
          label={
            needsLook.length === 1
              ? 'I acknowledge the student marked "Needs a look". This is recorded on their history.'
              : `I acknowledge these ${needsLook.length} students marked "Needs a look". This is recorded on their history.`
          }
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
      ) : null}
      {cannot.length > 0 ? (
        <p className="ultm8-field__hint">
          {cannot.length} student{cannot.length === 1 ? '' : 's'} can't be promoted and will be skipped.
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button
          type="button"
          onClick={confirm}
          loading={bulk.isPending && !checking}
          disabled={checking || !check || toPromote.length === 0 || (needsAck && !acknowledged)}
        >
          Promote {toPromote.length} student{toPromote.length === 1 ? '' : 's'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** A self-contained printable page (prototype buildPromotionReportHtml): the
 * style, date, note and the promotions in calling order, with a Print / Save
 * as PDF button that the printout hides. */
export function promotionReportHtml(styleName: string, note: string, date: string, rows: ReportRow[]): string {
  const body = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.from)}</td><td>${esc(r.to)}</td></tr>`).join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>Promotion report — ${esc(styleName)}</title>` +
    '<style>body{font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#151719}' +
    'h1{font-size:20px;margin:0 0 4px}.meta{color:#50575e;font-size:13px;margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:16px}' +
    'th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e1e3e5;font-size:13px}th{font-size:11px;text-transform:uppercase;color:#50575e}' +
    'button{margin-top:24px;padding:10px 16px;border-radius:8px;border:1px solid #5d7081;background:#5d7081;color:#fff;font-weight:600;cursor:pointer}' +
    '@media print{button{display:none}body{margin:0;max-width:none}}</style></head><body>' +
    '<h1>Promotion report</h1>' +
    `<p class="meta">${esc(styleName)} · ${esc(date)} · ${rows.length} student${rows.length === 1 ? '' : 's'} promoted</p>` +
    (note ? `<p class="meta">${esc(note)}</p>` : '') +
    `<table><thead><tr><th>#</th><th>Student</th><th>From</th><th>To</th></tr></thead><tbody>${body}</tbody></table>` +
    '<button onclick="window.print()">Print / Save as PDF</button></body></html>'
  );
}
