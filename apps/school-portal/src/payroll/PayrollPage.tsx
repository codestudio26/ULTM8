import React, { useEffect, useState } from 'react';
import { Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Spinner, SuccessBanner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { useSchool, useUpdateSchool } from '../schools/schoolQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { MoneyField } from '../lib/MoneyField';
import { CurrencyFirstNotice } from '../lib/CurrencyFirstNotice';
import { csvCell, downloadCsv } from '../transactions/transactionsCsv';
import { BillingCard, BillingDate, BillingHead, BillingMore, BillingPage, BillingSelect } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
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
 * included. Whether their report shows the rates (read only) is the owner's
 * choice, on the Rates tab (off by default: classes, hours and pay only; the
 * API leaves the rates out). The API checks the same.
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
    <BillingPage>
      <BillingHead
        header={<NewLookPageHeader title={t('payroll.title')} subtitle={t(isOwner || !schoolId ? 'payroll.subtitle' : 'payroll.subtitleStaff')} />}
        // The Rates tab is the owners' alone; staff get the report and no tabs.
        tabs={
          isOwner
            ? [
                { id: 'report', label: t('payroll.tabReport') },
                { id: 'rates', label: t('payroll.tabRates') },
              ]
            : undefined
        }
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />
      {!schoolId ? <ErrorBanner message={t('payroll.noAccess')} /> : isOwner && tab === 'rates' ? <Rates schoolId={schoolId} /> : <Report schoolId={schoolId} />}
    </BillingPage>
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
    <div data-testid="payroll-report" className="u8b">
      <BillingCard
        flush
        toolbar={
          <>
            <div className="u8b-toolbar__group">
              <BillingSelect
                id="payroll-preset"
                label={t('payroll.periodLabel')}
                value={preset}
                onChange={(v) => pickPreset(v as PayrollPreset)}
                options={PAYROLL_PRESETS.map((p) => ({ value: p, label: t(`payroll.preset.${p}`) }))}
              />
              {preset === 'CUSTOM' ? (
                <>
                  <BillingDate id="payroll-from" label={t('payroll.fromLabel')} value={from} max={to || undefined} onChange={setFrom} />
                  <BillingDate id="payroll-to" label={t('payroll.toLabel')} value={to} min={from || undefined} onChange={setTo} />
                </>
              ) : null}
            </div>
            {data && data.rows.length > 0 ? (
              <BillingMore>
                <Button variant="secondary" className="u8b-pill" onClick={() => exportCsv(data, t)}>
                  {t('payroll.download')}
                </Button>
              </BillingMore>
            ) : null}
          </>
        }
      >
        <p className="u8b-note">{t('payroll.howCounted')}</p>
        {report.error ? (
          <div className="u8b-pad" style={{ paddingBottom: 20 }}>
            <ErrorBanner message={report.error instanceof ApiError && report.error.status === 403 ? t('payroll.noAccess') : errorText(report.error, t('payroll.loadFailed'))} />
          </div>
        ) : report.isLoading || !report.data ? (
          preset === 'CUSTOM' && (!from || !to) ? null : (
            <div className="u8b-pad" style={{ paddingBottom: 20 }}>
              <Spinner />
            </div>
          )
        ) : (
          <>
            {!report.data.ratesShown ? (
              <p className="u8b-note" data-testid="payroll-rates-hidden">
                {t('payroll.ratesHidden')}
              </p>
            ) : null}
            <ReportTable data={report.data} />
          </>
        )}
      </BillingCard>
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
    <>
      <h3 className="u8b-card__sub u8b-pad" style={{ margin: '4px 0 12px' }}>
        {t('payroll.rangeShown', { from: dateLabel(data.from), to: dateLabel(data.to) })}
      </h3>
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
                <span className="u8b-cell-line">
                  <span className="u8b-name">{r.name}</span>
                  {!r.onStaff ? <Badge>{t('payroll.leftSchool')}</Badge> : null}
                </span>
              ),
          },
          { key: 'classes', header: t('payroll.columnClasses'), render: (r) => String(r.classesTaught) },
          { key: 'hours', header: t('payroll.columnHours'), render: (r) => hours(r.minutesTaught) },
          // Left out when the School doesn't show staff the rates (Decision 435 item 22).
          ...(data.ratesShown
            ? [
                { key: 'hourly', header: t('payroll.columnHourlyRate'), render: (r: Row) => (r.isTotal ? '' : money(r.hourlyRate)) },
                { key: 'perClass', header: t('payroll.columnPerClassRate'), render: (r: Row) => (r.isTotal ? '' : money(r.perClassRate)) },
              ]
            : []),
          { key: 'pay', header: t('payroll.columnPay'), render: (r) => <strong>{formatMoney(r.pay, data.currency)}</strong> },
        ]}
      />
    </>
  );
}

/** The report as a CSV: one line per person and a total line. Amounts are
 * plain numbers with two decimals, hours with up to two, so a spreadsheet can
 * add them up (as the other CSVs in the portal do). */
function exportCsv(data: PayrollReport, t: ReturnType<typeof useT>) {
  const money = (minor: number | null) => (minor === null ? '' : (minor / 100).toFixed(2));
  const hrs = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
  // The rate columns only when the report carries them (Decision 435 item 22).
  const rateCells = (hourly: string, perClass: string) => (data.ratesShown ? [hourly, perClass] : []);
  const header = [
    t('payroll.columnName'),
    t('payroll.columnClasses'),
    t('payroll.columnHours'),
    ...rateCells(t('payroll.columnHourlyRate'), t('payroll.columnPerClassRate')),
    t('payroll.columnPay'),
    t('payroll.columnCurrency'),
  ];
  const currency = data.currency ?? '';
  const lines = [header.map(csvCell).join(',')];
  for (const r of data.rows) {
    lines.push([r.name, String(r.classesTaught), hrs(r.minutesTaught), ...rateCells(money(r.hourlyRate), money(r.perClassRate)), money(r.pay), currency].map(csvCell).join(','));
  }
  lines.push([t('payroll.total'), String(data.totalClasses), hrs(data.totalMinutes), ...rateCells('', ''), money(data.totalPay), currency].map(csvCell).join(','));
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
    <div data-testid="payroll-rates" className="u8b">
      <StaffRatesSetting schoolId={schoolId} />
      {!currency ? <CurrencyFirstNotice /> : null}
      {saved ? <SuccessBanner message={t('payroll.saved', { name: saved })} /> : null}
      <BillingCard flush>
        <p className="u8b-note" style={{ paddingTop: 20 }}>
          {t('payroll.ratesIntro')}
        </p>
        {items.length === 0 ? (
          <EmptyState title={t('payroll.emptyRates')} description={t('payroll.emptyRatesDescription')} />
        ) : (
          <Table<PayRateRow & { id: string }>
            rows={items.map((r) => ({ ...r, id: r.userId }))}
            columns={[
              {
                key: 'name',
                header: t('payroll.columnName'),
                render: (r) => (
                  <span className="u8b-cell-line">
                    <span className="u8b-name">{r.name}</span>
                    {r.roles.length === 0 ? <Badge>{t('payroll.leftSchool')}</Badge> : null}
                  </span>
                ),
              },
              { key: 'rates', header: `${t('payroll.columnHourlyRate')} · ${t('payroll.columnPerClassRate')}`, render: (r) => <RateEditor schoolId={schoolId} row={r} currency={currency} onSaved={setSaved} /> },
            ]}
          />
        )}
      </BillingCard>
    </div>
  );
}

/**
 * Decision 435 item 22 (owner's answer, 6 Nov 2026): whether staff with the
 * Payroll switch see the pay rates in their report, read only. A School
 * setting, off by default; owner only, as the Rates tab is.
 */
function StaffRatesSetting({ schoolId }: { schoolId: string }) {
  const t = useT();
  const school = useSchool(schoolId).data;
  const update = useUpdateSchool(schoolId);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the owner just picked, shown at once while it saves.
  const [picked, setPicked] = useState<boolean | null>(null);
  if (!school) return null;
  return (
    <BillingCard>
      <div data-testid="payroll-staff-rates-setting">
        <h2 className="u8b-card__title">{t('payroll.staffRates.title')}</h2>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Checkbox
          label={t('payroll.staffRates.label')}
          checked={picked ?? school.payrollStaffSeeRates}
          disabled={update.isPending}
          onChange={(e) => {
            const next = e.target.checked;
            setPicked(next);
            setSaved(false);
            setError(null);
            update.mutate(
              { payrollStaffSeeRates: next },
              {
                onSuccess: () => setSaved(true),
                onError: (err) => {
                  setPicked(null);
                  setError(errorText(err, t('common.tryAgain')));
                },
              },
            );
          }}
        />
        <p className="u8b-note">{t('payroll.staffRates.hint')}</p>
      </div>
    </BillingCard>
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
      <div>
        <Button
          variant="secondary"
          className="u8b-pill u8b-pill--row"
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
