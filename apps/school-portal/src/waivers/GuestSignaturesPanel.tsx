import React, { useState } from 'react';
import { Button, ErrorBanner, Spinner } from '@ultm8/ui';
import { useGuestSignature, useGuestSignatures } from './guestWaiverQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const dateText = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { dateStyle: 'medium' });

function SignedText({ schoolId, waiverId, signatureId }: { schoolId: string; waiverId: string; signatureId: string }) {
  const detail = useGuestSignature(schoolId, waiverId, signatureId);
  if (detail.isLoading) return <Spinner />;
  if (!detail.data) return null;
  return (
    <div style={{ whiteSpace: 'pre-line', fontSize: 13, lineHeight: 1.5, marginTop: 6, padding: 8, background: 'var(--surface-muted, #f6f6f6)', borderRadius: 6 }}>
      <strong>{detail.data.signedWaiverTitle}</strong>
      {'\n'}
      {detail.data.signedWaiverBody}
    </div>
  );
}

/** Guests who signed this waiver by their booking's link (Waivers Q9), with
 * the wording each signed. Owner/Manager only, like the Signatures panel. */
export function GuestSignaturesPanel({ schoolId, waiverId }: { schoolId: string; waiverId: string }) {
  const t = useT();
  const query = useGuestSignatures(schoolId, waiverId);
  const [open, setOpen] = useState<string | null>(null);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-label={t('waivers.guestSignatures.title')} style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 4px' }}>{t('waivers.guestSignatures.title')}</h3>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{t('waivers.guestSignatures.intro')}</p>
      {query.isLoading ? <Spinner /> : null}
      {query.error ? <ErrorBanner message={t('waivers.guestSignatures.loadFailed')} /> : null}
      {!query.isLoading && !query.error && rows.length === 0 ? <p style={{ fontSize: 13 }}>{t('waivers.guestSignatures.empty')}</p> : null}
      {rows.length ? (
        <table className="ultm8-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>{t('waivers.guestSignatures.columnGuest')}</th>
              <th>{t('waivers.guestSignatures.columnClass')}</th>
              <th>{t('waivers.guestSignatures.columnSigned')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr>
                  <td>
                    {r.guestFullName}
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {t('waivers.guestSignatures.dob', { date: dateText(`${r.guestDateOfBirth}T00:00:00Z`) })}
                      {r.signedByGuardian ? ` · ${t('waivers.guestSignatures.byGuardian', { name: r.signerFullName })}` : ''}
                    </div>
                  </td>
                  <td>
                    {r.classTitle}, {dateText(r.classStartsAt)}
                    {r.bookedByName ? <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('waivers.guestSignatures.bookedBy', { name: r.bookedByName })}</div> : null}
                  </td>
                  <td>{dateText(r.signedAt)}</td>
                  <td>
                    <Button variant="secondary" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      {open === r.id ? t('waivers.guestSignatures.hide') : t('waivers.guestSignatures.view')}
                    </Button>
                  </td>
                </tr>
                {open === r.id ? (
                  <tr>
                    <td colSpan={4}>
                      <SignedText schoolId={schoolId} waiverId={waiverId} signatureId={r.id} />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      ) : null}
      {query.hasNextPage ? (
        <Button variant="secondary" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
          {t('waivers.guestSignatures.loadMore')}
        </Button>
      ) : null}
    </section>
  );
}
