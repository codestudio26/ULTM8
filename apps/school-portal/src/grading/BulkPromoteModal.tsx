import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { BeltChip } from './BeltChip';
import { promoteToOptions, type Rung } from './ladder';
import { RankPicker } from './RankPicker';
import { BulkPromotePartialError, type BulkPromoteResult, type BulkPromoteStudent, type GradingBoardItem, useBulkPromote } from './gradingQueries';
import { useT, type TranslateFn } from '../i18n/I18nProvider';

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
 * Promote the ticked students (Decision 130; prototype BulkPromoteModal): set
 * the calling order (drag, or the Up/Down buttons), one date and one note.
 * Each student has a "Promote to" picker (Decision 281 item 2; DESIGN.md
 * "Promote selected: pick the rank"), starting on their next rank: any higher
 * rank (a skip is recorded), and for a Kids student who has reached "Ready
 * for Adult from age", the linked Adult program's ranks (backlog 3.20). The API checks every student first (a dry run) and the
 * window shows three groups: ready; "Needs a look" (skills not signed off or
 * days short, with the reason) — promoted only with one tick acknowledging
 * them, or remove them; and can't be promoted, which are skipped. Afterwards a
 * printable report lists the promotions in calling order.
 */
export function BulkPromoteModal({
  schoolId,
  style,
  ladder,
  adult,
  students,
  onRemove,
  onDone,
  onClose,
}: {
  schoolId: string;
  style: DisciplineResponse;
  ladder: Rung[];
  /** A Kids style's linked Adult program and its ladder, for the "Adult program" group. */
  adult?: { discipline: DisciplineResponse; ladder: Rung[] } | null;
  students: GradingBoardItem[];
  onRemove: (studentId: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const bulk = useBulkPromote(schoolId);
  const t = useT();
  const [order, setOrder] = useState<string[]>(() => students.map((s) => s.studentId));
  // "Promote to" picks that differ from the next rank, by student.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [check, setCheck] = useState<BulkPromoteResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ rows: ReportRow[]; waiting: ReportRow[]; skipped: Array<{ name: string; reasons: string[] }>; date: string } | null>(null);
  // A batch that stopped part-way (Decision 284): what is done, and who is left to try again.
  const [partial, setPartial] = useState<{ done: BulkPromoteResult; remaining: string[]; batch: string[] } | null>(null);
  const dragId = useRef<string | null>(null);

  const byId = (id: string) => students.find((s) => s.studentId === id);
  const rung = (id: string | null | undefined) => ladder.find((r) => r.id === id) ?? adult?.ladder.find((r) => r.id === id) ?? null;
  const latestCheck = useRef(0);
  const choicesFor = (s: GradingBoardItem) => promoteToOptions(ladder, rung(s.currentStripeId), adult, s.readyForAdult);
  const targetsFor = (ids: string[], p: Record<string, string> = picks) =>
    ids.filter((id) => p[id]).map((id) => ({ studentId: id, rungId: p[id] }));

  /** Check the batch (a dry run). Each student's check stands on its own, so
   * removing a student needs no new check; only the date (or a failed check)
   * does. That keeps a large batch inside the API's request limit. */
  function runCheck(ids: string[], p: Record<string, string> = picks) {
    if (report || ids.length === 0) return;
    const mine = ++latestCheck.current;
    setChecking(true);
    setError(null);
    bulk
      .mutateAsync({
        disciplineId: style.id,
        studentIds: ids,
        dryRun: true,
        ...(date && date !== todayLocal() ? { effectiveDate: date } : {}),
        ...(targetsFor(ids, p).length > 0 ? { targets: targetsFor(ids, p) } : {}),
      })
      .then((r) => {
        if (mine === latestCheck.current) setCheck(r);
      })
      .catch((err) => {
        if (mine === latestCheck.current) {
          setCheck(null);
          setError(err instanceof ApiError ? err.message : t('grading.bulk.checkFailed'));
        }
      })
      .finally(() => {
        if (mine === latestCheck.current) setChecking(false);
      });
  }

  // Check when the window opens and whenever the date changes.
  useEffect(() => {
    runCheck(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Only students still in the batch count.
  const inBatch = (r: { studentId: string }) => order.includes(r.studentId);
  const needsLook = (check?.needsAcknowledgement ?? []).filter(inBatch);
  const cannot = (check?.cannotPromote ?? []).filter(inBatch);
  const flagged = (id: string) => needsLook.find((n) => n.studentId === id);
  const blocked = (id: string) => cannot.find((n) => n.studentId === id);
  const toPromote = order.filter((id) => !blocked(id));

  function remove(id: string) {
    const next = order.filter((x) => x !== id);
    setOrder(next);
    onRemove(id);
    // A failed check (e.g. the date didn't suit this student) is run again without them.
    if (!check) runCheck(next);
  }

  /** A new "Promote to" pick is checked for that student alone; their row in
   * the check is replaced, so the batch needs no new check (Decision 284 item 4). */
  function pickFor(s: GradingBoardItem, rungId: string) {
    const id = s.studentId;
    const next = { ...picks };
    if (rungId === s.eligibility.nextRungId) delete next[id];
    else next[id] = rungId;
    setPicks(next);
    if (!check) return runCheck(order, next);
    const mine = ++latestCheck.current;
    setChecking(true);
    setError(null);
    bulk
      .mutateAsync({
        disciplineId: style.id,
        studentIds: [id],
        dryRun: true,
        ...(date && date !== todayLocal() ? { effectiveDate: date } : {}),
        ...(targetsFor([id], next).length > 0 ? { targets: targetsFor([id], next) } : {}),
      })
      .then((r) => {
        if (mine !== latestCheck.current) return;
        const others = (list: BulkPromoteStudent[]) => list.filter((x) => x.studentId !== id);
        setCheck((c) =>
          c
            ? {
                ready: [...others(c.ready), ...r.ready],
                needsAcknowledgement: [...others(c.needsAcknowledgement), ...r.needsAcknowledgement],
                cannotPromote: [...others(c.cannotPromote), ...r.cannotPromote],
              }
            : r,
        );
      })
      .catch((err) => {
        if (mine === latestCheck.current) {
          setCheck(null);
          setError(err instanceof ApiError ? err.message : t('grading.bulk.checkFailed'));
        }
      })
      .finally(() => {
        if (mine === latestCheck.current) setChecking(false);
      });
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

  const effective = date && date !== todayLocal() ? date : undefined;
  const join = (a: BulkPromoteResult, b: BulkPromoteResult): BulkPromoteResult => ({
    ready: [...a.ready, ...b.ready],
    needsAcknowledgement: [],
    cannotPromote: [...a.cannotPromote, ...b.cannotPromote],
    waitingForFee: [...(a.waitingForFee ?? []), ...(b.waitingForFee ?? [])],
  });

  /** Promote `ids`, adding to what earlier tries already did. Each student
   * carries the rung the check found them on, so trying again never promotes
   * anyone twice (Decision 284). */
  async function send(ids: string[], batch: string[], before: BulkPromoteResult) {
    setError(null);
    const wanted = new Set(ids);
    const expected = [...(check?.ready ?? []), ...(check?.needsAcknowledgement ?? [])]
      .filter((r) => wanted.has(r.studentId) && r.fromRungId)
      .map((r) => ({ studentId: r.studentId, rungId: r.fromRungId as string }));
    const acknowledgedIds = needsLook.map((n) => n.studentId).filter((id) => wanted.has(id));
    try {
      const result = await bulk.mutateAsync({
        disciplineId: style.id,
        studentIds: ids,
        ...(effective ? { effectiveDate: effective } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(acknowledgedIds.length > 0 ? { acknowledgedStudentIds: acknowledgedIds } : {}),
        ...(expected.length > 0 ? { expected } : {}),
        ...(targetsFor(ids).length > 0 ? { targets: targetsFor(ids) } : {}),
      });
      finish(join(before, result), batch, []);
    } catch (err) {
      // Sent 200 at a time (Decision 282): a later batch failed even after one
      // automatic retry. Keep what is done and offer the rest again.
      if (err instanceof BulkPromotePartialError) {
        setPartial({ done: join(before, err.done), remaining: err.remaining, batch });
        return;
      }
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  function confirm() {
    return send(toPromote, toPromote, { ready: [], needsAcknowledgement: [], cannotPromote: [], waitingForFee: [] });
  }

  /** "Blue Belt (Adult program)" or "Green Belt (skipped 2)" (DESIGN.md). */
  function toLabel(r: BulkPromoteStudent): string {
    const to = rung(r.toRungId);
    if (!to) return '—';
    if (r.toAdult) return `${to.name} ${t('grading.bulk.adultTag')}`;
    const from = rung(r.fromRungId);
    const skipped = from ? to.index - from.index - 1 : 0;
    return skipped > 0 ? `${to.name} ${t('grading.bulk.skippedTag', { count: skipped })}` : to.name;
  }

  /** The done window and report, in calling order; `notReached` are students
   * a stopped batch never got to. */
  function finish(result: BulkPromoteResult, batch: string[], notReached: string[]) {
    const nameOf = (id: string) => fullName(byId(id) ?? { firstName: t('grading.studentFallback'), surname: '' });
    const rows = batch
      .map((id) => result.ready.find((r) => r.studentId === id))
      .filter((r): r is BulkPromoteStudent => !!r)
      .map((r) => ({ name: nameOf(r.studentId), from: rung(r.fromRungId)?.name ?? '—', to: toLabel(r) }));
    // Priced grades with "Allow grading before the fee is paid" off (Decision
    // 300 item 6), a move into Adult included (Decision 419 item 2): not
    // promoted yet; each waits for its fee, shown on the board as "Waiting for fee".
    const waiting = batch
      .map((id) => (result.waitingForFee ?? []).find((r) => r.studentId === id))
      .filter((r): r is BulkPromoteStudent => !!r)
      .map((r) => ({ name: nameOf(r.studentId), from: rung(r.fromRungId)?.name ?? '—', to: toLabel(r) }));
    setPartial(null);
    setReport({
      rows,
      waiting,
      // Names now: the board's selection is cleared once the batch is done.
      skipped: [
        ...[...cannot, ...result.cannotPromote.filter((c) => !cannot.some((x) => x.studentId === c.studentId))].map((c) => ({
          name: nameOf(c.studentId),
          reasons: c.reasons,
        })),
        ...notReached.map((id) => ({ name: nameOf(id), reasons: [t('grading.bulk.notReached')] })),
      ],
      date: effective ?? todayLocal(),
    });
    onDone();
  }

  function openReport() {
    if (!report) return;
    const html = promotionReportHtml(t, style.name, note.trim(), report.date, report.rows);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
  }

  if (partial) {
    const total = partial.batch.length;
    return (
      <Modal title={t('grading.bulk.title')} onClose={() => finish(partial.done, partial.batch, partial.remaining)}>
        <ErrorBanner message={t('grading.bulk.stoppedPartWay', { done: partial.done.ready.length, total })} />
        {error ? <ErrorBanner message={error} /> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Button type="button" onClick={() => send(partial.remaining, partial.batch, partial.done)} loading={bulk.isPending}>
            {t('grading.bulk.tryRemaining', { count: partial.remaining.length })}
          </Button>
          <Button type="button" variant="secondary" onClick={() => finish(partial.done, partial.batch, partial.remaining)} disabled={bulk.isPending}>
            {t('grading.bulk.stopHere')}
          </Button>
        </div>
      </Modal>
    );
  }

  if (report) {
    return (
      <Modal title={t('grading.bulk.doneTitle')} onClose={onClose}>
        {error ? <ErrorBanner message={error} /> : null}
        <p>{t('grading.bulk.youPromoted', { count: report.rows.length })}</p>
        <ol style={{ paddingLeft: 20 }}>
          {report.rows.map((r, i) => (
            <li key={i}>
              {r.name}: {r.from} → {r.to}
            </li>
          ))}
        </ol>
        {report.waiting.length > 0 ? (
          <p role="note" data-testid="bulk-waiting-for-fee" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-warning)' }}>
            {t('grading.bulk.waitingForFee', { list: report.waiting.map((r) => `${r.name} (${r.to})`).join(', ') })}
          </p>
        ) : null}
        {report.skipped.length > 0 ? (
          <ErrorBanner
            message={t('grading.bulk.notPromoted', { list: report.skipped.map((s) => `${s.name} (${s.reasons.join('; ')})`).join(', ') })}
          />
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={openReport} disabled={report.rows.length === 0}>
            {t('grading.bulk.openReport')}
          </Button>
          <Button type="button" onClick={onClose}>
            {t('common.done')}
          </Button>
        </div>
      </Modal>
    );
  }

  const needsAck = needsLook.length > 0;
  return (
    <Modal title={t('grading.bulk.title')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
        {t('grading.bulk.intro')}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 160 }}>
          <Field label={t('grading.bulk.dateLabel')} htmlFor="bulk-date" hint={t('grading.bulk.dateHint')}>
            <TextField type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field label={t('grading.bulk.noteLabel')} htmlFor="bulk-note" hint={t('grading.bulk.noteHint')}>
            <TextField maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      {order.length === 0 ? (
        <p>{t('grading.bulk.nothingSelected')}</p>
      ) : (
        <ol aria-label={t('grading.bulk.callingOrder')} style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 6, maxHeight: '45vh', overflow: 'auto' }}>
          {order.map((id, i) => {
            const s = byId(id);
            if (!s) return null;
            const name = fullName(s);
            const from = rung(s.currentStripeId);
            const { options, adultIds, firstAdultId } = choicesFor(s);
            const toId = picks[id] ?? s.eligibility.nextRungId ?? '';
            const to = options.find((r) => r.id === toId) ?? null;
            const toAdult = !!to && adultIds.has(to.id);
            const skipped = to && from && !toAdult ? to.index - from.index - 1 : 0;
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
                  {toAdult ? <div style={{ color: 'var(--text-accent)', fontSize: 12 }}>{t('grading.modals.grade.adultNote')}</div> : null}
                  {skipped > 0 ? <div style={{ color: 'var(--text-accent)', fontSize: 12 }}>{t('grading.modals.grade.skips', { count: skipped })}</div> : null}
                  {flag ? <div style={{ color: 'var(--text-warning)', fontSize: 12 }}>{t('grading.bulk.needsLook', { reasons: flag.reasons.join('; ') })}</div> : null}
                  {skip ? <div style={{ color: 'var(--text-danger)', fontSize: 12 }}>{t('grading.bulk.cantPromote', { reasons: skip.reasons.join('; ') })}</div> : null}
                </span>
                {from ? <BeltChip rung={from} /> : null}
                <span aria-hidden="true">→</span>
                {options.length > 0 ? (
                  <span style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}>
                    <RankPicker
                      id={`bulk-to-${id}`}
                      ariaLabel={t('grading.bulk.promoteToAria', { name })}
                      value={toId}
                      onChange={(rungId) => pickFor(s, rungId)}
                      options={options}
                      suffix={(r) => (adultIds.has(r.id) ? t('grading.modals.grade.adultSuffix') : null)}
                      heading={(r) => (r.id === firstAdultId ? t('grading.modals.grade.adultHeading') : null)}
                    />
                  </span>
                ) : null}
                <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
                  <Button type="button" variant="secondary" onClick={() => moveBy(id, -1)} disabled={i === 0} aria-label={t('grading.bulk.moveUpAria', { name })}>
                    ↑
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => moveBy(id, 1)} disabled={i === order.length - 1} aria-label={t('grading.bulk.moveDownAria', { name })}>
                    ↓
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => remove(id)} aria-label={t('grading.bulk.removeAria', { name })}>
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
          label={t('grading.bulk.acknowledge', { count: needsLook.length })}
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
      ) : null}
      {cannot.length > 0 ? (
        <p className="ultm8-field__hint">{t('grading.bulk.willBeSkipped', { count: cannot.length })}</p>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button
          type="button"
          onClick={confirm}
          loading={bulk.isPending && !checking}
          disabled={checking || !check || toPromote.length === 0 || (needsAck && !acknowledged)}
        >
          {t('grading.bulk.promoteCount', { count: toPromote.length })}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
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
 * as PDF button that the printout hides. `t` is the caller's translator: the
 * page is built outside React, so it can't read the language itself. */
export function promotionReportHtml(t: TranslateFn, styleName: string, note: string, date: string, rows: ReportRow[]): string {
  const body = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.from)}</td><td>${esc(r.to)}</td></tr>`).join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${esc(t('grading.bulk.report.title', { style: styleName }))}</title>` +
    '<style>body{font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#151719}' +
    'h1{font-size:20px;margin:0 0 4px}.meta{color:#50575e;font-size:13px;margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:16px}' +
    'th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e1e3e5;font-size:13px}th{font-size:11px;text-transform:uppercase;color:#50575e}' +
    'button{margin-top:24px;padding:10px 16px;border-radius:8px;border:1px solid #5d7081;background:#5d7081;color:#fff;font-weight:600;cursor:pointer}' +
    '@media print{button{display:none}body{margin:0;max-width:none}}</style></head><body>' +
    `<h1>${esc(t('grading.bulk.report.heading'))}</h1>` +
    `<p class="meta">${esc(styleName)} · ${esc(date)} · ${esc(t('grading.bulk.report.promotedCount', { count: rows.length }))}</p>` +
    (note ? `<p class="meta">${esc(note)}</p>` : '') +
    `<table><thead><tr><th>${esc(t('grading.bulk.report.columnNumber'))}</th><th>${esc(t('grading.bulk.report.columnStudent'))}</th>` +
    `<th>${esc(t('grading.bulk.report.columnFrom'))}</th><th>${esc(t('grading.bulk.report.columnTo'))}</th></tr></thead><tbody>${body}</tbody></table>` +
    `<button onclick="window.print()">${esc(t('grading.bulk.report.print'))}</button></body></html>`
  );
}
