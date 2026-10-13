import type { Lesson } from '../curriculum/curriculumQueries';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  VerifyOtp: { phone?: string } | undefined;
  ForgotPasscode: undefined;
  ResetPasscode: { phone?: string } | undefined;
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
  /** No params — self-view only (see curriculumQueries.ts's header comment for why
   * a Guardian viewing a linked minor's Lessons isn't built yet). */
  Lessons: undefined;
  /** `lesson` rides along with `lessonId` so the detail screen doesn't need its own
   * fetch — there is no student-facing "get one Lesson by id" endpoint (only the
   * list endpoint LessonsScreen already called), so this is the only way to land on
   * this screen with the full Lesson shape (videoRef/captionStatus/etc.) in hand. */
  LessonDetail: { lessonId: string; lesson: Lesson };
  Playlists: undefined;
  PlaylistDetail: { playlistId: string; name: string };
  MyMinors: undefined;
  MinorConsent: { studentId: string; name: string };
  KidModePin: undefined;
  KidModeBooking: undefined;
  PendingReview: undefined;
  QrCheckIn: undefined;
  CoachDashboard: undefined;
  /** No params: the signed-in student's own grading; a guardian passes the minor's id. */
  MyGrading: { studentId: string; name: string } | undefined;
  GradingHistory: { studentId: string; schoolId: string; title: string };
  GradingBoard: { schoolId: string; disciplineId: string; name: string };
  CoachStudent: { schoolId: string; disciplineId: string; studentId: string; name: string; styleName: string };
};
