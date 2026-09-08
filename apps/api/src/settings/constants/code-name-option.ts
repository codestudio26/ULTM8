/**
 * Shared `{code, name}` shape backing both languages.ts and currencies.ts —
 * consolidated on code review from two structurally identical interfaces defined
 * separately, which had no shared type to hang a field added to one but not the
 * other on.
 */
export interface CodeNameOption {
  code: string;
  name: string;
}
