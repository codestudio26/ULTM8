import type { Lesson } from '../curriculum/curriculumQueries';

/** Decision 266 — Apple 4.2.6/4.3 compliance (Decision 247's "one shared app,
 * School picked after install"). A single screen, not a multi-step stack —
 * search and join-code entry are two modes of the ONE SchoolPickScreen, not
 * separate navigation destinations. */
export type SchoolPickStackParamList = {
  SchoolPick: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  VerifyOtp: { phone?: string } | undefined;
  ForgotPasscode: undefined;
  ResetPasscode: { phone?: string } | undefined;
  /** First sign-in with a temporary passcode (Decision 371). */
  ChoosePasscode: { passcodeChangeToken: string };
};

export type AppStackParamList = {
  Home: undefined;
  Profile: undefined;
  Academies: undefined;
  AcademyDetail: { academyId: string; name: string };
  /** Join a School (or add a belt at one already joined), for oneself or a
   * guardian's child: home branch, then current belt per style (Decisions 137, 209). */
  JoinSchool: { academyId: string; name: string; beltsFor?: { studentId: string; name: string } };
  MyBookings: undefined;
  Notifications: undefined;
  MyMemberships: undefined;
  TransactionHistory: undefined;
  Waivers: undefined;
  PaymentMethods: undefined;
  /** No params: the signed-in student's own Lessons; a guardian passes the minor's id. */
  Lessons: { studentId: string; name: string } | undefined;
  /** `lesson` rides along with `lessonId` so the detail screen doesn't need its own
   * fetch — there is no student-facing "get one Lesson by id" endpoint (only the
   * list endpoint LessonsScreen already called), so this is the only way to land on
   * this screen with the full Lesson shape (videoRef/captionStatus/etc.) in hand.
   * `studentId` carries LessonsScreen's own guardian-view context through — present
   * only when a guardian opened this from a linked minor's Lessons, absent for a
   * Student's own. LessonDetailScreen needs it: Favorite/WatchHistory/Playlist/
   * Comment have no guardian-delegation path server-side (Decision 254's own
   * disclosed gap), so those actions run under the caller's own identity — the
   * guardian's, not the minor's — and must be hidden rather than shown and 403ing. */
  LessonDetail: { lessonId: string; lesson: Lesson; studentId?: string };
  Playlists: undefined;
  PlaylistDetail: { playlistId: string; name: string };
  MyMinors: undefined;
  MinorConsent: { studentId: string; name: string };
  /** Decision 379: a parent books classes (with guests) for this child. */
  ChildBooking: { studentId: string; name: string };
  KidModePin: undefined;
  KidModeBooking: undefined;
  PendingReview: undefined;
  QrCheckIn: undefined;
  /** Decision 400: notes the School shows the student; a guardian passes the child's id. */
  SchoolNotes: { studentId?: string; name?: string } | undefined;
  CoachDashboard: undefined;
  /** No params: the signed-in student's own grading; a guardian passes the minor's id. */
  /** `openFeeId` opens that promotion fee's answer straight away (the Home card). */
  MyGrading: { studentId?: string; name?: string; openFeeId?: string } | undefined;
  GradingHistory: { studentId: string; schoolId: string; title: string };
  GradingBoard: { schoolId: string; disciplineId: string; name: string };
  CoachStudent: { schoolId: string; disciplineId: string; studentId: string; name: string; styleName: string };
};
