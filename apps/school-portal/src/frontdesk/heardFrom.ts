import { useT } from '../i18n/I18nProvider';

/**
 * Decision 392 (Decision 315 item 6): the "How did you hear about us?"
 * choices. A School that hasn't edited its list gets the starting list, in the
 * viewer's language; once edited, its own list as written.
 */
export function useHeardFromChoices(options: string[] | null | undefined): string[] {
  const t = useT();
  return options ?? defaultHeardFrom(t);
}

export function defaultHeardFrom(t: ReturnType<typeof useT>): string[] {
  return [t('frontDesk.heardFrom.friend'), t('frontDesk.heardFrom.instagram'), t('frontDesk.heardFrom.google'), t('frontDesk.heardFrom.walkedPast')];
}
