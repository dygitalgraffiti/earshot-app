// app/_layout.tsx
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Handle deep links and share intents
  useEffect(() => {
    const handleIncomingUrl = async (url: string) => {
      // Only store if it's a valid share URL (not our own deep link scheme or Expo dev URLs)
      if (!url || !url.trim() || 
          url.startsWith('earshotmobile://') || 
          url.startsWith('exp://') ||
          url.startsWith('exps://')) {
        return;
      }

      // Store the URL in AsyncStorage so index.tsx can pick it up
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage');
        await AsyncStorage.default.setItem('pendingShareUrl', url);
      } catch (e) {
        console.warn('Failed to store pending URL:', e);
      }
    };

    // Clear any stale pending URLs on app boot
    const clearStaleUrls = async () => {
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage');
        const pending = await AsyncStorage.default.getItem('pendingShareUrl');
        // Always clear on boot to prevent stale data
        if (pending) {
          console.log('Clearing stale pending URL on boot:', pending);
          await AsyncStorage.default.removeItem('pendingShareUrl');
        }
      } catch (e) {
        // Ignore errors
        console.warn('Error clearing stale URLs:', e);
      }
    };
    clearStaleUrls();

    // Handle initial URL (app opened via share intent)
    Linking.getInitialURL().then((url) => {
      if (url && url.trim() && 
          !url.startsWith('earshotmobile://') &&
          !url.startsWith('exp://') &&
          !url.startsWith('exps://')) {
        handleIncomingUrl(url);
      }
    });

    // Handle URLs while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      if (event.url && event.url.trim() && 
          !event.url.startsWith('earshotmobile://') &&
          !event.url.startsWith('exp://') &&
          !event.url.startsWith('exps://')) {
        handleIncomingUrl(event.url);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          {/* Main tab navigator - only this should show tabs */}
          <Stack.Screen name="(tabs)" />

          {/* Profile – reachable from feed, NOT in tab bar */}
          <Stack.Screen
            name="ProfileScreen"
            options={{
              headerShown: true,
              title: 'Profile',
              headerStyle: { backgroundColor: '#000' },
              headerTintColor: '#1DB954',
              headerTitleStyle: { fontWeight: 'bold' },
              headerBackTitle: 'Back',
            }}
          />

          {/* Modal - NOT in tab bar */}
          <Stack.Screen 
            name="modal" 
            options={{ 
              presentation: 'modal',
              headerShown: false,
            }} 
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}