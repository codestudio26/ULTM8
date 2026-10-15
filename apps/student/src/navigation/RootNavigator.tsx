import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { SchoolThemeProvider } from '../theme/SchoolThemeContext';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';
import { SchoolPickNavigator } from './SchoolPickNavigator';

/** Three-way branch, not two — Decision 266 (Apple 4.2.6/4.3 compliance,
 * Decision 247's "one shared app, School picked after install") added a
 * screen ahead of the original accessToken gate: a signed-OUT session with
 * no School picked yet sees SchoolPickNavigator FIRST, before AuthNavigator.
 * Once a School is picked (AuthContext's pendingSchoolPick, persisted —
 * survives a restart, so this doesn't re-ask on every launch), it falls
 * through to the ordinary login/signup flow exactly as before. A signed-in
 * session is unaffected either way — `accessToken` still wins outright, same
 * as before this feature existed.
 *
 * `loading` covers the brief async SecureStore read at launch (see
 * AuthContext) — without it the app would flash the wrong screen even for an
 * already logged-in or already-picked-a-School session. */
export function RootNavigator() {
  const { loading, accessToken, pendingSchoolPick } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!accessToken && !pendingSchoolPick) {
    return (
      <NavigationContainer>
        <SchoolPickNavigator />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      {accessToken ? (
        <SchoolThemeProvider>
          <AppNavigator />
        </SchoolThemeProvider>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
