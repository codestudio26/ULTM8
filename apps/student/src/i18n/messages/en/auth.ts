/** English text: auth (Decision 323). */
export const auth = {
  /** Shared by the login, register, verify and reset screens. */
  errors: {
    generic: 'Something went wrong — please try again.',
  },
  fields: {
    email: 'Email',
    phone: 'Phone',
    passcode: 'Passcode',
    sixDigits: '6 digits',
    verificationCode: 'Verification code',
  },
  login: {
    title: 'Log in',
    intro: "Email and your 6-digit passcode — that's your whole login (no separate password).",
    submit: 'Log in',
    createAccount: 'Create an account',
    forgotPasscode: 'Forgot your passcode?',
  },
  register: {
    title: 'Create your account',
    intro: 'Register, then verify your phone to log in.',
    passcodeMismatch: 'Passcode and confirmation must match.',
    firstName: 'First name',
    surname: 'Surname',
    username: 'Username',
    optional: 'Optional',
    passcodeHint: '6 digits — this is your entire login credential',
    confirmPasscode: 'Confirm passcode',
    dateOfBirth: 'Date of birth',
    /** The date format the field expects; shown as hint and placeholder. */
    dateFormat: 'YYYY-MM-DD',
    submit: 'Create account',
    haveAccount: 'Already have an account? Log in',
  },
  verifyOtp: {
    title: 'Verify your phone',
    intro: 'Enter the code we sent to complete registration.',
    resendFailed: 'Could not resend the code.',
    resent: 'Code resent.',
    verify: 'Verify',
    resend: 'Resend code',
  },
  forgotPasscode: {
    title: 'Reset your passcode',
    intro: "We'll text a verification code to your phone.",
    sendCode: 'Send code',
    backToLogin: 'Back to log in',
  },
  resetPasscode: {
    title: 'Set a new passcode',
    intro: 'Enter the code we sent, then choose a new 6-digit passcode.',
    mismatch: 'New passcode and confirmation must match.',
    newPasscode: 'New passcode',
    confirmNewPasscode: 'Confirm new passcode',
    submit: 'Set new passcode',
  },
  /** First sign-in with a temporary passcode from the School (Decision 371). */
  choosePasscode: {
    title: "Choose your passcode",
    intro: "Your School gave you a temporary passcode. Choose your own 6-digit passcode to finish signing in.",
    submit: "Save and sign in",
  },
  /** Re-entering one's passcode to confirm a sensitive action. */
  stepUp: {
    prompt: 'Re-enter your passcode to confirm.',
    incorrect: 'Incorrect passcode — please try again.',
    cancel: 'Cancel',
    confirm: 'Confirm',
  },
};
