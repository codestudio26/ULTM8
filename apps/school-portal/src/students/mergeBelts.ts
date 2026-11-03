import type { TranslationKey } from '../i18n/I18nProvider';

/** A style both records have a belt in (MergeBeltKeptDto), as the preview needs it. */
export interface BeltKept {
  styleName: string;
  keptFrom: 'KEPT' | 'DUPLICATE';
  keptBelt: string;
  otherBelt: string;
  sameRung: boolean;
}

/** The preview's line for one style (Decision 422 item 8): which belt is
 * kept, named with the record it comes from. */
export function beltKeptLine(b: BeltKept, keptName: string, duplicateName: string): { key: TranslationKey; params: Record<string, string> } {
  const name = b.keptFrom === 'KEPT' ? keptName : duplicateName;
  return b.sameRung
    ? { key: 'students.merge.beltSameRung', params: { style: b.styleName, belt: b.keptBelt, name } }
    : { key: 'students.merge.beltKept', params: { style: b.styleName, belt: b.keptBelt, name, otherBelt: b.otherBelt } };
}
