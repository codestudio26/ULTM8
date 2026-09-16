import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';

/** Swaps the whole navigation tree on accessToken presence — the same "logged in vs.
 * not" gate apps/school-portal's RequireAuth enforces per-route, done once at the root
 * here since every screen behind Home needs a session (no anonymous-browsable screens
 * in this slice). `loading` covers the brief async SecureStore read at launch (see
 * AuthContext) — without it the app would flash the login screen even for an already
 * logged-in user. */
export function RootNavigator() {
  const { loading, accessToken } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <NavigationContainer>{accessToken ? <AppNavigator /> : <AuthNavigator />}</NavigationContainer>;
}
