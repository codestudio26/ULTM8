import React, { useState } from 'react';
import { Spinner } from '@ultm8/ui';
import { Note, Pill } from './WaiversLook';
import { useGuestSignature, useGuestSignatures } from './guestWaiverQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const dateText = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { dateStyle: 'medium' });

function SignedText({ schoolId, waiverId, signatureId }: { schoolId: string; waiverId: string; signatureId: string }) {
  const detail = useGuestSignature(schoolId, waiverId, signatureId);
  if (detail.isLoading) return <Spinner />;
  if (!detail.data) return null;
  return (
    <div className="u8w-guest__text">
      <strong>{detail.data.signedWaiverTitle}</strong>
      {'\n'}
      {detail.data.signedWaiverBody}
    </div>
  );
}

/** Guests who signed this waiver by their booking's link (Waivers Q9), with
 * the wording each signed. Owner/Manager only, like the Signatures panel.
 * In the new look it sits in the right-hand panel under Signatures, one
 * stacked row per guest (who, the class, when they signed, View). */
export function GuestSignaturesPanel({ schoolId, waiverId }: { schoolId: string; waiverId: string }) {
  const t = useT();
  const query = useGuestSignatures(schoolId, waiverId);
  const [open, setOpen] = useState<string | null>(null);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-label={t('waivers.guestSignatures.title')} className="u8w-guests">
      <h3 className="u8n-inspector__label">{t('waivers.guestSignatures.title')}</h3>
      <p className="u8w-guests__intro">{t('waivers.guestSignatures.intro')}</p>
      {query.isLoading ? <Spinner /> : null}
      {query.error ? <Note kind="error" message={t('waivers.guestSignatures.loadFailed')} /> : null}
      {!query.isLoading && !query.error && rows.length === 0 ? <p className="u8w-guests__empty">{t('waivers.guestSignatures.empty')}</p> : null}
      {rows.length ? (
        <ul className="u8w-sigs">
          {rows.map((r) => (
            <li key={r.id} className="u8w-guest">
              <div className="u8w-guest__who">
                <span className="u8w-sig__name">{r.guestFullName}</span>
                <span className="u8w-guest__line">
                  {t('waivers.guestSignatures.dob', { date: dateText(`${r.guestDateOfBirth}T00:00:00Z`) })}
                  {r.signedByGuardian ? ` · ${t('waivers.guestSignatures.byGuardian', { name: r.signerFullName })}` : ''}
                </span>
              </div>
              <dl className="u8w-guest__facts">
                <div>
                  <dt>{t('waivers.guestSignatures.columnClass')}</dt>
                  <dd>
                    {r.classTitle}, {dateText(r.classStartsAt)}
                    {r.bookedByName ? <span className="u8w-guest__line">{t('waivers.guestSignatures.bookedBy', { name: r.bookedByName })}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt>{t('waivers.guestSignatures.columnSigned')}</dt>
                  <dd>{dateText(r.signedAt)}</dd>
                </div>
              </dl>
              <Pill small onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                {open === r.id ? t('waivers.guestSignatures.hide') : t('waivers.guestSignatures.view')}
              </Pill>
              {open === r.id ? <SignedText schoolId={schoolId} waiverId={waiverId} signatureId={r.id} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {query.hasNextPage ? (
        <div className="u8w-signatures__actions">
          <Pill onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
            {t('waivers.guestSignatures.loadMore')}
          </Pill>
        </div>
      ) : null}
    </section>
  );
}
