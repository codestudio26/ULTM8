import { CodeNameOption } from './code-name-option';

/**
 * Spec 55 §11.1 (quoted, not paraphrased): "4 languages observed: English (UK),
 * Portuguese (BR), Spanish, Arabic." Explicitly tagged **observed**, not confirmed —
 * no business decision anywhere states this is the final, immutable list, and
 * `User.language`'s own schema comment already flags the underlying ambiguity
 * ("one of the 4 confirmed languages... stored as free text pending a confirmed
 * canonical code list, not specified anywhere"). Serving this observed list is the
 * best available evidence for that free-text field's own waiting-on-a-list caveat,
 * not a resolution of it — flagged for Architect review before it's trusted as
 * final. See the Phase 7 kickoff prompt for the full reasoning.
 *
 * BCP-47-shaped codes are a Developer convention, not something Spec 55 states.
 */
export const LANGUAGES: readonly CodeNameOption[] = [
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'pt-BR', name: 'Portuguese (BR)' },
  { code: 'es', name: 'Spanish' },
  { code: 'ar', name: 'Arabic' },
];
