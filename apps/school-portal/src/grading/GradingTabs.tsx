import { useLocation } from 'react-router-dom';
import { useIsCoachOnly } from '../auth/AuthContext';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/**
 * "Grading" in the menu opens these tabs (DESIGN.md → "Grading screens":
 * Board · Styles & Belts · Skills · Permissions · Settings). Styles & Belts is
 * the Disciplines page. Permissions is the owner's (Decision 184).
 */
function useTabList(): Array<{ to: string; label: TranslationKey; end?: boolean }> {
  const isCoachOnly = useIsCoachOnly();
  return [
    { to: '/grading', label: 'grading.tabs.board', end: true },
    { to: '/disciplines', label: 'grading.tabs.stylesAndBelts' },
    { to: '/grading/skills', label: 'grading.tabs.skills' },
    ...(isCoachOnly ? [] : [{ to: '/grading/permissions', label: 'grading.tabs.permissions' as TranslationKey }]),
    { to: '/grading/settings', label: 'grading.tabs.settings' },
  ];
}

/** The tabs for the new look's page header (`NewLookPageHeader`'s `tabs`
 * and `tabsLabel`), the current one marked. Every Grading page uses these;
 * the old `GradingTabs` bar is gone (Decision 460 item 17). */
export function useGradingHeaderTabs(): { tabs: Array<{ to: string; label: string; current: boolean }>; tabsLabel: string } {
  const t = useT();
  const { pathname } = useLocation();
  const tabs = useTabList().map((tab) => ({
    to: tab.to,
    label: t(tab.label),
    current: pathname === tab.to || (!tab.end && pathname.startsWith(`${tab.to}/`)),
  }));
  return { tabs, tabsLabel: t('grading.tabs.aria') };
}
