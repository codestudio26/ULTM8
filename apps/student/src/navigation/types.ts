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
};
