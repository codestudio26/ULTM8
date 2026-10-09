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
  /** Optional schoolId deep-links to that School's section (ClassBookingRow's
   * WAIVER_REQUIRED error) — undefined/omitted is the ordinary "browse everything"
   * entry from Home. */
  Waivers: { schoolId?: string } | undefined;
  MyMinors: undefined;
  MinorConsent: { studentId: string; name: string };
  CheckIn: undefined;
};
