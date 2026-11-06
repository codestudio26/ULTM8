import React from 'react';
import { useT } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';
import { legalPath, type LegalSlug } from './legalPages';

/**
 * Decision 440 (C1): the "I agree" tick before an account, a School or a
 * Franchise is created. The box is required, so the form can't be sent
 * without it, and the server refuses it too. Each link opens the page in a
 * new tab, so what the person has typed is kept.
 */
export function LegalAgreeCheckbox({
  kind,
  checked,
  onChange,
}: {
  /** "account": Terms of Service and Privacy Policy. "agreement": the School and Franchise Agreement. */
  kind: 'account' | 'agreement';
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useT();
  const link = (slug: LegalSlug, text: string) => (
    <a href={legalPath(slug)} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
  return (
    <label className="ultm8-checkbox" style={{ alignItems: 'flex-start', marginTop: 12 }}>
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>
        {kind === 'account' ? (
          <Trans
            k="legal.agree.account"
            nodes={{
              terms: link('terms-and-conditions', t('legal.titles.terms')),
              privacy: link('privacy-statement', t('legal.titles.privacy')),
            }}
          />
        ) : (
          <Trans k="legal.agree.agreement" nodes={{ agreement: link('school-agreement', t('legal.titles.schoolAgreement')) }} />
        )}
      </span>
    </label>
  );
}
