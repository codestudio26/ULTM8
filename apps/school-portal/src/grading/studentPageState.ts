import { useLocation } from 'react-router-dom';

/**
 * What a link to a student's page (/students/:id) passes along in the
 * router's location state: the student's name, for a student a coach's list
 * doesn't include, and where the person came from. `from: 'grading'` is set
 * by the Grading Board's links only; the page's "‹" link then goes back to
 * the board, and to Students for any other way in.
 */
export interface StudentPageState {
  name?: string;
  from?: 'grading';
}

/** The state for a link to a student's page from the Grading Board. */
export function fromGradingBoard(name: string): StudentPageState {
  return { name, from: 'grading' };
}

/** This location's student-page state (empty for a saved link or a typed URL). */
export function useStudentPageState(): StudentPageState {
  return ((useLocation().state as StudentPageState | null) ?? {});
}
