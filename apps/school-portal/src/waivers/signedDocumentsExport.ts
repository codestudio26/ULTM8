import type { components } from '@ultm8/api-client';
import type { TranslateFn } from '../i18n/I18nProvider';

type Labels = components['schemas']['SignedDocumentLabelsDto'];
type Body = components['schemas']['CreateSignedDocumentExportDto'];
type SignedDocumentExport = components['schemas']['SignedDocumentExportDto'];

/** Whether the "Include member files" tick box is shown (Decision 422 item
 * 9): only to an owner of this School. Staff never see it, and the API
 * refuses them in any case. */
export function mayIncludeMemberFiles(ownedSchoolIds: readonly string[], schoolId: string): boolean {
  return !!schoolId && ownedSchoolIds.includes(schoolId);
}

/** What the dialog sends to start an export. Member files are asked for
 * only when the box was shown and ticked. */
export function exportRequestBody(labels: Labels, options: { mayIncludeMemberFiles: boolean; includeMemberFiles: boolean }): Body {
  return { labels, includeMemberFiles: options.mayIncludeMemberFiles && options.includeMemberFiles };
}

/** The "Ready" line, with the member files counted when the export has them. */
export function exportReadyText(t: TranslateFn, current: Pick<SignedDocumentExport, 'documentCount' | 'includeMemberFiles' | 'memberFileCount'>, size: string): string {
  if (current.includeMemberFiles) {
    return t('waivers.exportAll.readyWithFiles', { count: current.documentCount ?? 0, files: current.memberFileCount ?? 0, size });
  }
  return t('waivers.exportAll.ready', { count: current.documentCount ?? 0, size });
}
