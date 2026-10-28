import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../auth/LoginScreen';
import { RegisterScreen } from '../auth/RegisterScreen';
import { VerifyOtpScreen } from '../auth/VerifyOtpScreen';
import { ForgotPasscodeScreen } from '../auth/ForgotPasscodeScreen';
import { ResetPasscodeScreen } from '../auth/ResetPasscodeScreen';
import { ChoosePasscodeScreen } from '../auth/ChoosePasscodeScreen';
import { useT } from '../i18n/I18nProvider';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: true, title: t('navigation.auth.register') }} />
      <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} options={{ headerShown: true, title: t('navigation.auth.verifyPhone') }} />
      <Stack.Screen
        name="ForgotPasscode"
        component={ForgotPasscodeScreen}
        options={{ headerShown: true, title: t('navigation.auth.resetPasscode') }}
      />
      <Stack.Screen
        name="ResetPasscode"
        component={ResetPasscodeScreen}
        options={{ headerShown: true, title: t('navigation.auth.newPasscode') }}
      />
      <Stack.Screen
        name="ChoosePasscode"
        component={ChoosePasscodeScreen}
        options={{ headerShown: true, title: t('navigation.auth.choosePasscode') }}
      />
    </Stack.Navigator>
  );
}
