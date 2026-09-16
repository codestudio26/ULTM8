import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../auth/LoginScreen';
import { RegisterScreen } from '../auth/RegisterScreen';
import { VerifyOtpScreen } from '../auth/VerifyOtpScreen';
import { ForgotPasscodeScreen } from '../auth/ForgotPasscodeScreen';
import { ResetPasscodeScreen } from '../auth/ResetPasscodeScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: true, title: 'Register' }} />
      <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} options={{ headerShown: true, title: 'Verify phone' }} />
      <Stack.Screen
        name="ForgotPasscode"
        component={ForgotPasscodeScreen}
        options={{ headerShown: true, title: 'Reset passcode' }}
      />
      <Stack.Screen
        name="ResetPasscode"
        component={ResetPasscodeScreen}
        options={{ headerShown: true, title: 'New passcode' }}
      />
    </Stack.Navigator>
  );
}
