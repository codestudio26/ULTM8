import React from 'react';
import { LEGAL_FOOTER_LINKS } from '@ultm8/ui';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useSchool, useSchoolFranchiseBranding } from '../schools/schoolQueries';
import { useDisciplines } from '../disciplines/disciplineQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';

const SOCIAL_LINKS = [
  { key: 'footerFacebookUrl', label: 'Facebook', abbr: 'f' },
  { key: 'footerInstagramUrl', label: 'Instagram', abbr: 'IG' },
  { key: 'footerTiktokUrl', label: 'TikTok', abbr: 'TT' },
  { key: 'footerYoutubeUrl', label: 'YouTube', abbr: 'YT' },
  { key: 'footerTwitterUrl', label: 'X', abbr: 'X' },
] as const;

/** `LEGAL_FOOTER_LINKS` (@ultm8/ui) carries English labels; the two shown
 * here are translated by label, and anything else falls back to the label. */
const LEGAL_LABELS: Record<string, TranslationKey> = {
  'Terms of Service': 'layout.footer.termsOfService',
  'Privacy Policy': 'layout.footer.privacyPolicy',
};

/**
 * Decision 257 — the School Portal's own richer, per-School footer (columns,
 * a decorative zip search, "Get the app" QR placeholders, social links),
 * replacing the plain platform-wide `LegalFooter` (Decision 256) ONLY here —
 * `apps/platform-admin` and `apps/student` keep the simple one, since neither
 * has a single "current School" context the way this app does (Platform
 * Admin spans every School; `apps/student`'s own Student/Guardian may be
 * enrolled at several). Rendered inside AppShell's existing `legalFooter`
 * slot (`Shell.tsx`), so that slot's own top border/spacing still applies.
 *
 * Every per-School field (`footerAboutUs`/`footerContactEmail`/
 * `footerContactPhone`/each social URL) is independently optional — per the
 * product owner's own explicit instruction, an unset field hides its own
 * line/icon entirely rather than showing an empty or placeholder state. Only
 * Terms of Service / Privacy Policy stay the fixed, always-shown (but still
 * disabled-for-now) platform-wide links from Decision 256 — a School isn't a
 * separate legal entity publishing its own ToS for this software, so those
 * two are filtered OUT of `LEGAL_FOOTER_LINKS` here just for "Support" (this
 * footer's Support column shows the School's own real Contact info instead).
 *
 * The zip search and the two "Get the app" QR tiles are deliberately
 * decorative only: no cross-School "find a school" search exists anywhere in
 * this codebase (the header's Global Search, Decision 278, only searches the
 * caller's own records — see
 * `docs/decisions/DRAFT-global-search-and-footer-scoping.md` §A), and
 * `apps/student` isn't published to an app store yet (Decision 256's own
 * disclosed gap) — plain placeholder boxes, not real/scannable QR codes
 * pointing nowhere, so nothing here claims to work that doesn't.
 */
export function SchoolFooter() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const { data: school } = useSchool(schoolId);
  // Decision 350 — set only when both the Franchise Owner and the School Owner allow it.
  const { data: branding } = useSchoolFranchiseBranding(school?.franchiseId ? schoolId : null);
  const { data: disciplines } = useDisciplines(schoolId);
  const year = new Date().getFullYear();

  if (!schoolId || !school) return null;

  const programs = disciplines?.items ?? [];
  const legalLinks = LEGAL_FOOTER_LINKS.filter((l) => l.label !== 'Support');
  const activeSocial = SOCIAL_LINKS.filter((s) => !!school[s.key]);

  return (
    <div>
      <div className="ultm8-school-footer__top">
        <div className="ultm8-school-footer__brand-col">
          <p className="ultm8-school-footer__brand">{school.name}</p>
          {branding?.name ? (
            <p className="ultm8-school-footer__col-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-testid="footer-franchise-branding">
              {branding.logoUrl ? <img src={branding.logoUrl} alt="" width={24} height={24} style={{ objectFit: 'contain' }} /> : null}
              {t('layout.footer.partOfFranchise', { name: branding.name })}
            </p>
          ) : null}
          <label className="ultm8-school-footer__search-label" htmlFor="school-footer-zip">
            {t('layout.footer.findSchool')}
          </label>
          <input
            id="school-footer-zip"
            className="ultm8-input"
            disabled
            placeholder={t('layout.footer.zipPlaceholder')}
            aria-label={t('layout.footer.findSchoolAria')}
            style={{ width: 200 }}
          />
        </div>

        <div className="ultm8-school-footer__columns">
          {programs.length > 0 ? (
            <div className="ultm8-school-footer__col">
              <p className="ultm8-school-footer__col-title">{t('layout.footer.programs')}</p>
              {programs.map((d) => (
                <p key={d.id} className="ultm8-school-footer__col-item">
                  {d.name}
                </p>
              ))}
            </div>
          ) : null}

          <div className="ultm8-school-footer__col">
            <p className="ultm8-school-footer__col-title">{t('layout.footer.company')}</p>
            <p className="ultm8-school-footer__col-item">
              <a className="ultm8-school-footer__col-link" href="/instructors">
                {t('layout.footer.instructors')}
              </a>
            </p>
            <p className="ultm8-school-footer__col-item">
              <a className="ultm8-school-footer__col-link" href="/branches">
                {t('layout.footer.locations')}
              </a>
            </p>
            {school.footerAboutUs ? (
              <p className="ultm8-school-footer__col-item ultm8-school-footer__col-about">{school.footerAboutUs}</p>
            ) : null}
          </div>

          <div className="ultm8-school-footer__col">
            <p className="ultm8-school-footer__col-title">{t('layout.footer.support')}</p>
            {school.footerContactEmail ? (
              <p className="ultm8-school-footer__col-item">
                <a className="ultm8-school-footer__col-link" href={`mailto:${school.footerContactEmail}`}>
                  {school.footerContactEmail}
                </a>
              </p>
            ) : null}
            {school.footerContactPhone ? (
              <p className="ultm8-school-footer__col-item">
                <a className="ultm8-school-footer__col-link" href={`tel:${school.footerContactPhone}`}>
                  {school.footerContactPhone}
                </a>
              </p>
            ) : null}
            {legalLinks.map((link) => {
              const label = LEGAL_LABELS[link.label] ? t(LEGAL_LABELS[link.label]) : link.label;
              return link.enabled ? (
                <p key={link.label} className="ultm8-school-footer__col-item">
                  <a className="ultm8-school-footer__col-link" href={link.href}>
                    {label}
                  </a>
                </p>
              ) : (
                <p key={link.label} className="ultm8-school-footer__col-item" style={{ opacity: 0.6 }} aria-label={t('layout.footer.linkUnavailableAria', { label })}>
                  {t('layout.footer.linkComingSoon', { label })}
                </p>
              );
            })}
          </div>

          <div className="ultm8-school-footer__col">
            <p className="ultm8-school-footer__col-title">{t('layout.footer.getTheApp')}</p>
            <div className="ultm8-school-footer__qr-tile">
              <div className="ultm8-school-footer__qr-box">QR</div>
              <span className="ultm8-school-footer__qr-caption">
                <Trans k="layout.footer.comingSoonFor" vars={{ platform: 'iOS' }} nodes={{ br: <br /> }} />
              </span>
            </div>
            <div className="ultm8-school-footer__qr-tile">
              <div className="ultm8-school-footer__qr-box">QR</div>
              <span className="ultm8-school-footer__qr-caption">
                <Trans k="layout.footer.comingSoonFor" vars={{ platform: 'Android' }} nodes={{ br: <br /> }} />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="ultm8-school-footer__bottom">
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-caption)' }}>{t('layout.footer.copyright', { year })}</span>
        {activeSocial.length > 0 ? (
          <div className="ultm8-school-footer__social">
            {activeSocial.map((s) => (
              <a
                key={s.key}
                className="ultm8-school-footer__social-icon"
                href={school[s.key] as string}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
              >
                {s.abbr}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
