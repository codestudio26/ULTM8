export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  VerifyOtp: { phone?: string } | undefined;
  ForgotPasscode: undefined;
  ResetPasscode: { phone?: string } | undefined;
};

export type AppStackParamList = {
  Home: undefined;
  Academies: undefined;
  AcademyDetail: { academyId: string; name: string };
  MyBookings: undefined;
  Notifications: undefined;
  MyMemberships: undefined;
  Waivers: undefined;
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
