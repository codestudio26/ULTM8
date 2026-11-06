import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { MoneyField } from '../lib/MoneyField';
import { CurrencyFirstNotice } from '../lib/CurrencyFirstNotice';
import { csvCell, downloadCsv } from '../transactions/transactionsCsv';
import {
  PAYROLL_PRESETS,
  usePayRates,
  usePayrollReport,
  useSetPayRate,
  type PayRateRow,
  type PayrollPreset,
  type PayrollReport,
  type PayrollRow,
} from './payrollQueries';

type Tab = 'report' | 'rates';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Minutes as hours, two decimals at most: 150 → "2.5". */
function hours(minutes: number): string {
  return (minutes / 60).toLocaleString(formatLocale(), { maximumFractionDigits: 2 });
}

/** "2026-03-01" in the reader's language, read as a calendar date. */
function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Payroll (Decision 320 item 4): a report of what each member of staff
 * earned from the classes they taught, at the hourly and per-class rates the
 * owner sets, over a date range, with a CSV download. ULTM8 pays nobody.
 * The School's owners see the report and set the rates. Branch Staff with
 * the "Payroll" switch (Decision 435 item 22) see the report only, for the
 * whole School: no Rates tab, so no editing anyone's rate, their own
 * included. The API checks the same.
 */
export function PayrollPage() {
  const t = useT();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const staffAccess = useMyStaffAccess(ownedSchoolId ? null : coachSchoolId).data;
  const schoolId = ownedSchoolId ?? (staffAccess?.branchStaff && staffAccess.access.payroll ? coachSchoolId : null);
  // The rates are the owners' alone; switched-on staff get the report only.
  const isOwner = !!ownedSchoolId;
  const [tab, setTab] = useState<Tab>('report');

  return (
    <>
      <PageHeader title={t('payroll.title')} subtitle={t('payroll.subtitle')} />
      {isOwner ? (
        <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['report', 'rates'] as const).map((id) => (
            <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>
              {id === 'report' ? t('payroll.tabReport') : t('payroll.tabRates')}
            </Button>
          ))}
        </div>
      ) : null}
      {!schoolId ? <ErrorBanner message={t('payroll.noAccess')} /> : isOwner && tab === 'rates' ? <Rates schoolId={schoolId} /> : <Report schoolId={schoolId} />}
    </>
  );
}

function Report({ schoolId }: { schoolId: string }) {
  const t = useT();
  const [preset, setPreset] = useState<PayrollPreset>('LAST_30_DAYS');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const report = usePayrollReport(schoolId, preset, from, to);
  const data = report.data;

  // Custom dates start from the range on screen.
  function pickPreset(next: PayrollPreset) {
    if (next === 'CUSTOM' && report.data) {
      setFrom(report.data.from);
      setTo(report.data.to);
    }
    setPreset(next);
  }

  return (
    <div data-testid="payroll-report">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={t('payroll.periodLabel')} htmlFor="payroll-preset">
          <SelectField
            id="payroll-preset"
            value={preset}
            onChange={(e) => pickPreset(e.target.value as PayrollPreset)}
            options={PAYROLL_PRESETS.map((p) => ({ value: p, label: t(`payroll.preset.${p}`) }))}
          />
        </Field>
        {preset === 'CUSTOM' ? (
          <>
            <Field label={t('payroll.fromLabel')} htmlFor="payroll-from">
              <TextField id="payroll-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('payroll.toLabel')} htmlFor="payroll-to">
              <TextField id="payroll-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        ) : null}
        {data && data.rows.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            <Button variant="secondary" onClick={() => exportCsv(data, t)}>
              {t('payroll.download')}
            </Button>
          </div>
        ) : null}
      </div>
      <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
        {t('payroll.howCounted')}
      </p>
      {report.error ? (
        <ErrorBanner message={report.error instanceof ApiError && report.error.status === 403 ? t('payroll.noAccess') : errorText(report.error, t('payroll.loadFailed'))} />
      ) : report.isLoading || !report.data ? (
        preset === 'CUSTOM' && (!from || !to) ? null : <Spinner />
      ) : (
        <ReportTable data={report.data} />
      )}
    </div>
  );
}

function ReportTable({ data }: { data: PayrollReport }) {
  const t = useT();
  if (data.rows.length === 0) return <EmptyState title={t('payroll.emptyReport')} description={t('payroll.emptyReportDescription')} />;
  const money = (minor: number | null) => (minor === null ? t('common.none') : formatMoney(minor, data.currency));
  type Row = PayrollRow & { id: string; isTotal?: boolean };
  const rows: Row[] = [
    ...data.rows.map((r) => ({ ...r, id: r.userId })),
    { id: 'total', isTotal: true, userId: '', name: t('payroll.total'), onStaff: true, hourlyRate: null, perClassRate: null, classesTaught: data.totalClasses, minutesTaught: data.totalMinutes, pay: data.totalPay },
  ];
  return (
    <Card>
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('payroll.rangeShown', { from: dateLabel(data.from), to: dateLabel(data.to) })}</h3>
      <Table<Row>
        rows={rows}
        columns={[
          {
            key: 'name',
            header: t('payroll.columnName'),
            render: (r) =>
              r.isTotal ? (
                <strong>{r.name}</strong>
              ) : (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.name}
                  {!r.onStaff ? <Badge>{t('payroll.leftSchool')}</Badge> : null}
                </span>
              ),
          },
          { key: 'classes', header: t('payroll.columnClasses'), render: (r) => String(r.classesTaught) },
          { key: 'hours', header: t('payroll.columnHours'), render: (r) => hours(r.minutesTaught) },
          { key: 'hourly', header: t('payroll.columnHourlyRate'), render: (r) => (r.isTotal ? '' : money(r.hourlyRate)) },
          { key: 'perClass', header: t('payroll.columnPerClassRate'), render: (r) => (r.isTotal ? '' : money(r.perClassRate)) },
          { key: 'pay', header: t('payroll.columnPay'), render: (r) => <strong>{formatMoney(r.pay, data.currency)}</strong> },
        ]}
      />
    </Card>
  );
}

/** The report as a CSV: one line per person and a total line. Amounts are
 * plain numbers with two decimals, hours with up to two, so a spreadsheet can
 * add them up (as the other CSVs in the portal do). */
function exportCsv(data: PayrollReport, t: ReturnType<typeof useT>) {
  const money = (minor: number | null) => (minor === null ? '' : (minor / 100).toFixed(2));
  const hrs = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
  const header = [
    t('payroll.columnName'),
    t('payroll.columnClasses'),
    t('payroll.columnHours'),
    t('payroll.columnHourlyRate'),
    t('payroll.columnPerClassRate'),
    t('payroll.columnPay'),
    t('payroll.columnCurrency'),
  ];
  const currency = data.currency ?? '';
  const lines = [header.map(csvCell).join(',')];
  for (const r of data.rows) {
    lines.push([r.name, String(r.classesTaught), hrs(r.minutesTaught), money(r.hourlyRate), money(r.perClassRate), money(r.pay), currency].map(csvCell).join(','));
  }
  lines.push([t('payroll.total'), String(data.totalClasses), hrs(data.totalMinutes), '', '', money(data.totalPay), currency].map(csvCell).join(','));
  // A byte-order mark so Excel opens accented names correctly, as the other CSVs do.
  downloadCsv(`payroll-${data.from}-to-${data.to}.csv`, `﻿${lines.join('\r\n')}\r\n`);
}

function Rates({ schoolId }: { schoolId: string }) {
  const t = useT();
  const rates = usePayRates(schoolId);
  const [saved, setSaved] = useState<string | null>(null);
  if (rates.error) {
    return <ErrorBanner message={rates.error instanceof ApiError && rates.error.status === 403 ? t('payroll.noAccess') : errorText(rates.error, t('payroll.loadFailed'))} />;
  }
  if (rates.isLoading || !rates.data) return <Spinner />;
  const { currency, items } = rates.data;
  return (
    <div data-testid="payroll-rates">
      <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
        {t('payroll.ratesIntro')}
      </p>
      {!currency ? <CurrencyFirstNotice /> : null}
      {saved ? <SuccessBanner message={t('payroll.saved', { name: saved })} /> : null}
      {items.length === 0 ? (
        <EmptyState title={t('payroll.emptyRates')} description={t('payroll.emptyRatesDescription')} />
      ) : (
        <Card>
          <Table<PayRateRow & { id: string }>
            rows={items.map((r) => ({ ...r, id: r.userId }))}
            columns={[
              {
                key: 'name',
                header: t('payroll.columnName'),
                render: (r) => (
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {r.name}
                    {r.roles.length === 0 ? <Badge>{t('payroll.leftSchool')}</Badge> : null}
                  </span>
                ),
              },
              { key: 'rates', header: `${t('payroll.columnHourlyRate')} · ${t('payroll.columnPerClassRate')}`, render: (r) => <RateEditor schoolId={schoolId} row={r} currency={currency} onSaved={setSaved} /> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

function RateEditor({ schoolId, row, currency, onSaved }: { schoolId: string; row: PayRateRow; currency: string | null; onSaved: (name: string) => void }) {
  const t = useT();
  const setRate = useSetPayRate(schoolId);
  const [hourly, setHourly] = useState<{ value: number | null; valid: boolean }>({ value: row.hourlyRate, valid: true });
  const [perClass, setPerClass] = useState<{ value: number | null; valid: boolean }>({ value: row.perClassRate, valid: true });
  useEffect(() => {
    setHourly({ value: row.hourlyRate, valid: true });
    setPerClass({ value: row.perClassRate, valid: true });
  }, [row.hourlyRate, row.perClassRate]);
  const changed = hourly.value !== row.hourlyRate || perClass.value !== row.perClassRate;
  const valid = hourly.valid && perClass.valid;
  const id = row.userId;
  // Decision 414 item 6: no prices until the School's currency is set. A rate
  // saved before then can still be cleared.
  const noCurrency = !currency && row.hourlyRate === null && row.perClassRate === null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <Field label={t('payroll.hourlyRateLabel', { name: row.name })} htmlFor={`hourly-${id}`} error={hourly.valid ? undefined : t('payroll.invalidAmount')}>
        <MoneyField id={`hourly-${id}`} value={hourly.value} currency={currency} disabled={noCurrency} onChange={(value, ok) => setHourly({ value, valid: ok })} />
      </Field>
      <Field label={t('payroll.perClassRateLabel', { name: row.name })} htmlFor={`per-class-${id}`} error={perClass.valid ? undefined : t('payroll.invalidAmount')}>
        <MoneyField id={`per-class-${id}`} value={perClass.value} currency={currency} disabled={noCurrency} onChange={(value, ok) => setPerClass({ value, valid: ok })} />
      </Field>
      <div style={{ marginBottom: 16 }}>
        <Button
          variant="secondary"
          disabled={!changed || !valid}
          loading={setRate.isPending}
          onClick={() => setRate.mutate({ userId: row.userId, hourlyRate: hourly.value, perClassRate: perClass.value }, { onSuccess: () => onSaved(row.name) })}
        >
          {t('payroll.save')}
        </Button>
      </div>
      {setRate.error ? <ErrorBanner message={errorText(setRate.error, t('payroll.saveFailed'))} /> : null}
    </div>
  );
}
