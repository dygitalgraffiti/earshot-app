// app/(tabs)/index.tsx
import { extractUrlFromText, parseMusicUrl } from '@/utils/urlParser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');
const VINYL_SIZE = width * 0.75;

const API_URL = 'https://earshot-app.onrender.com';

interface Post {
  id: number;
  title: string;
  artist: string;
  thumbnail: string;
  username: string;
  url: string;
  createdAt: string;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [token, setToken] = useState<string | null>(null);
  const [feed, setFeed] = useState<Post[]>([]);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState<string | null>(null); // Current logged-in username
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [currentPostIndex, setCurrentPostIndex] = useState(0);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFlipped, setIsFlipped] = useState(false);
  const [listenerCount, setListenerCount] = useState(35);

  // Animation values
  const translateY = useSharedValue(0);
  const rotateZ = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const flipRotation = useSharedValue(0);
  const pulseOpacity = useSharedValue(0.4);

  // Load token on mount and handle share intents
  useEffect(() => {
    const initialize = async () => {
      try {
        // Get or create device ID (persists forever on this device)
        let deviceIdValue = await AsyncStorage.getItem('deviceId');
        if (!deviceIdValue) {
          // Generate a unique device ID and store it permanently
          deviceIdValue = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 9)}`;
          await AsyncStorage.setItem('deviceId', deviceIdValue);
        }
        setDeviceId(deviceIdValue);

        // Try to load saved token and username
        const savedToken = await AsyncStorage.getItem('authToken');
        const savedUsername = await AsyncStorage.getItem('currentUsername');
        if (savedUsername) {
          setCurrentUsername(savedUsername);
          console.log('Loaded saved username:', savedUsername);
        }
        if (savedToken) {
          setToken(savedToken);
          // If we don't have a username, try to get it from the feed or a user endpoint
          if (!savedUsername) {
            await fetchCurrentUsername(savedToken);
          }
          await loadFeed(savedToken);
        } else {
          // Auto-login with device ID if no token
          if (deviceIdValue) {
            await login(deviceIdValue);
          } else {
            setLoading(false);
          }
        }
      } catch (e) {
        console.warn('Failed to initialize:', e);
        setLoading(false);
      }
    };
    initialize();

    // Handle share intents (Android) - only check after a short delay to avoid false positives
    const handleShareIntent = async () => {
      try {
        // Clear any stale pending URLs first
        const staleUrl = await AsyncStorage.getItem('pendingShareUrl');
        if (staleUrl) {
          // Clear if it's invalid, our own scheme, or Expo dev URLs
          if (!staleUrl.trim() || 
              staleUrl.startsWith('earshotmobile://') ||
              staleUrl.startsWith('exp://') ||
              staleUrl.startsWith('exps://')) {
            await AsyncStorage.removeItem('pendingShareUrl');
            console.log('Cleared stale pending URL:', staleUrl);
          }
        }

        // Small delay to ensure app is fully loaded
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check for pending share URL
        const pendingUrl = await AsyncStorage.getItem('pendingShareUrl');
        if (pendingUrl && pendingUrl.trim() && 
            !pendingUrl.startsWith('earshotmobile://') &&
            !pendingUrl.startsWith('exp://') &&
            !pendingUrl.startsWith('exps://')) {
          console.log('Processing pending share URL:', pendingUrl);
          await AsyncStorage.removeItem('pendingShareUrl');
          handleIncomingShare(pendingUrl);
          return;
        }

        // Don't check initial URL here - _layout.tsx handles it and stores in AsyncStorage
        // This avoids double-processing

        // Listen for URLs while app is running
        const subscription = Linking.addEventListener('url', (event) => {
          // Only process if it's not our own deep link scheme or Expo dev URLs
          if (event.url && event.url.trim() && 
              !event.url.startsWith('earshotmobile://') &&
              !event.url.startsWith('exp://') &&
              !event.url.startsWith('exps://')) {
            console.log('Received URL event:', event.url);
            handleIncomingShare(event.url);
          }
        });

        return () => {
          subscription.remove();
        };
      } catch (e) {
        console.warn('Failed to handle share intent:', e);
      }
    };

    handleShareIntent();
  }, []);

  // Reload username when screen comes into focus (e.g., returning from profile)
  useFocusEffect(
    useCallback(() => {
      const reloadUsername = async () => {
        const savedUsername = await AsyncStorage.getItem('currentUsername');
        if (savedUsername) {
          setCurrentUsername(savedUsername);
        }
      };
      reloadUsername();
    }, [])
  );

  const handleIncomingShare = async (sharedData: string) => {
    try {
      // Skip if no data or empty string
      if (!sharedData || !sharedData.trim()) {
        console.log('No share data received');
        return;
      }

      // Skip if it's our own deep link scheme or Expo dev URLs
      if (sharedData.startsWith('earshotmobile://') ||
          sharedData.startsWith('exp://') ||
          sharedData.startsWith('exps://')) {
        console.log('Skipping own deep link scheme or Expo URL');
        return;
      }

      // Extract URL from shared text
      const extractedUrl = extractUrlFromText(sharedData);
      if (!extractedUrl || !extractedUrl.trim()) {
        console.log('No URL found in shared data');
        return;
      }

      // Skip if it's our own deep link scheme or Expo dev URLs (after extraction)
      if (extractedUrl.startsWith('earshotmobile://') ||
          extractedUrl.startsWith('exp://') ||
          extractedUrl.startsWith('exps://')) {
        console.log('Skipping own deep link scheme or Expo URL (extracted)');
        return;
      }

      // Parse and validate the URL
      const parsed = parseMusicUrl(extractedUrl);
      if (!parsed.isValid) {
        // Only show alert if we actually got a URL that's invalid AND it looks like a real URL attempt
        // Don't show alert for empty/undefined URLs or our own scheme
        const looksLikeUrl = extractedUrl.includes('://') || extractedUrl.includes('.') || extractedUrl.includes('/');
        const isExpoUrl = extractedUrl.startsWith('exp://') || extractedUrl.startsWith('exps://');
        if (extractedUrl && extractedUrl.trim().length > 0 && looksLikeUrl && 
            !extractedUrl.startsWith('earshotmobile://') && !isExpoUrl) {
          console.log('Invalid URL detected:', extractedUrl);
          Alert.alert('Invalid URL', 'Please share a valid Spotify, Apple Music, or YouTube link');
        } else {
          console.log('Skipping invalid URL alert for:', extractedUrl);
        }
        return;
      }

      // Pre-fill the URL input
      setUrl(parsed.url);
      
      // Optional: Auto-post if user is logged in
      if (token) {
        Alert.alert(
          'Share to Earshot',
          `Share "${parsed.platform}" track?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Share',
              onPress: async () => {
                await postTrack();
              },
            },
          ]
        );
      } else {
        // If not logged in, just pre-fill the URL
        Alert.alert('URL Ready', 'Log in to share this track');
      }
    } catch (e) {
      console.error('Error handling share:', e);
    }
  };

  const currentPost = feed[currentPostIndex];
  const showArtist = currentPost?.artist && currentPost.artist.toLowerCase() !== 'unknown artist';
  const hasNext = currentPostIndex < feed.length - 1;
  const hasPrevious = currentPostIndex > 0;

  // Debug: Log when component renders
  useEffect(() => {
    console.log('HomeScreen rendered, feed length:', feed.length, 'currentIndex:', currentPostIndex);
  }, [feed.length, currentPostIndex]);

  // Update listener count randomly every 3-7 seconds
  useEffect(() => {
    const updateListenerCount = () => {
      const newCount = Math.floor(Math.random() * (50 - 25 + 1)) + 25;
      setListenerCount(newCount);
    };

    // Initial random count
    updateListenerCount();

    // Update at random intervals
    const interval = setInterval(() => {
      updateListenerCount();
    }, Math.random() * 4000 + 3000); // 3-7 seconds

    return () => clearInterval(interval);
  }, []);

  // Pulsing animation for listener count
  useEffect(() => {
    const animatePulse = () => {
      pulseOpacity.value = withTiming(0.8, { duration: 1000 });
      setTimeout(() => {
        pulseOpacity.value = withTiming(0.4, { duration: 1000 });
      }, 1000);
    };

    animatePulse();
    const interval = setInterval(animatePulse, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // reset flip when post changes
    setIsFlipped(false);
    flipRotation.value = 0;
  }, [currentPostIndex]);

  const toggleFlip = () => {
    const next = !isFlipped;
    setIsFlipped(next);
    flipRotation.value = withTiming(next ? 180 : 0, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
  };

  /* ────── AUTH ────── */
  const fetchCurrentUsername = async (t: string) => {
    try {
      const res = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const userData = await res.json();
        if (userData.username) {
          console.log('Fetched current username:', userData.username);
          setCurrentUsername(userData.username);
          await AsyncStorage.setItem('currentUsername', userData.username);
        }
      } else {
        console.warn('Failed to fetch current user, status:', res.status);
      }
    } catch (e) {
      console.warn('Failed to fetch username:', e);
    }
  };

  const login = async (deviceIdParam?: string) => {
    const deviceIdToUse = deviceIdParam || deviceId;
    if (!deviceIdToUse || typeof deviceIdToUse !== 'string') {
      Alert.alert('Error', 'Device ID not available');
      setLoading(false);
      return;
    }
    try {
      // Prepare request body - only include username if it's not empty
      const requestBody: { device_id: string; username?: string } = {
        device_id: String(deviceIdToUse),
      };
      
      const trimmedUsername = username.trim();
      if (trimmedUsername) {
        requestBody.username = trimmedUsername;
      }
      
      console.log('Login request:', { device_id: requestBody.device_id, has_username: !!requestBody.username });
      
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      console.log('Login response status:', res.status, res.statusText);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.log('Login error response:', errorData);
        Alert.alert('Login Failed', errorData.error || `HTTP ${res.status}: ${res.statusText}`);
        setLoading(false);
        return;
      }
      
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        await AsyncStorage.setItem('authToken', data.token);
        // Update username if it was auto-generated
        if (data.user && data.user.username) {
          setUsername(data.user.username);
          setCurrentUsername(data.user.username);
          await AsyncStorage.setItem('currentUsername', data.user.username);
        }
        await loadFeed(data.token);
      } else {
        Alert.alert('Login Failed', data.error || 'Try again');
        setLoading(false);
      }
    } catch (e) {
      console.error('Login error:', e);
      Alert.alert('Network Error', 'Check your connection');
      setLoading(false);
    }
  };

  const loadFeed = async (t: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/feed`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      
      if (!res.ok) {
        if (res.status === 401) {
          // Token expired, clear it silently
          console.log('Token expired, clearing auth');
          await AsyncStorage.removeItem('authToken');
          setToken(null);
          setFeed([]);
          // Don't show alert here - let user continue using app
          // They'll see login screen on next interaction
          return;
        }
        console.error('Feed API error:', res.status, res.statusText);
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      console.log('Feed API response:', data);
      console.log('Feed type:', typeof data, 'Is array:', Array.isArray(data));
      
      if (Array.isArray(data)) {
        console.log('Feed loaded:', data.length, 'posts');
        setFeed(data);
        setCurrentPostIndex(0);
      } else {
        console.error('Feed is not an array:', data);
        setFeed([]);
        Alert.alert('Feed Error', 'Invalid response from server');
      }
    } catch (e) {
      console.error('Feed error:', e);
      Alert.alert('Feed Error', `Could not load posts: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setFeed([]);
    } finally {
      setLoading(false);
    }
  };

  const postTrack = async () => {
    console.log('postTrack called, url:', url, 'token exists:', !!token);
    
    if (!url.trim()) {
      Alert.alert('Empty URL', 'Please enter a URL to post');
      return;
    }
    
    if (!token) {
      Alert.alert('Not Logged In', 'Please log in to post');
      return;
    }

    try {
      console.log('Posting track:', url.trim());
      const res = await fetch(`${API_URL}/api/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: url.trim() }),
      });
      
      if (!res.ok) {
        if (res.status === 401) {
          // Token expired
          await AsyncStorage.removeItem('authToken');
          setToken(null);
          Alert.alert('Session Expired', 'Please log in again to post');
          return;
        }
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        Alert.alert('Post Failed', errorData.error || `HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      if (data.success) {
        Alert.alert('Posted!', `${data.post.title}`);
        setUrl('');
        // Reload feed - if token expired, loadFeed will handle it
        try {
          await loadFeed(token);
        } catch (e) {
          // Feed reload failed (likely token expired), but post was successful
          console.log('Feed reload failed after post, but post was successful');
        }
      } else {
        Alert.alert('Post Failed', data.error || 'Unknown error');
      }
    } catch (e) {
      console.error('Post error:', e);
      Alert.alert('Post Failed', e instanceof Error ? e.message : 'Network error. Try again.');
    }
  };

  /* ────── NAVIGATION ────── */
  const goToNext = () => {
    if (hasNext) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCurrentPostIndex(prev => prev + 1);
      translateY.value = 0;
      rotateZ.value = 0;
      scale.value = 1;
      opacity.value = 1;
    }
  };

  const goToPrevious = () => {
    if (hasPrevious) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCurrentPostIndex(prev => prev - 1);
      translateY.value = 0;
      rotateZ.value = 0;
      scale.value = 1;
      opacity.value = 1;
    }
  };

  /* ────── GESTURES ────── */
  const panGesture = Gesture.Pan()
    .onUpdate(e => {
      translateY.value = e.translationY;
      // More dramatic rotation for swooshing effect
      rotateZ.value = e.translationX * 0.2;
      // More pronounced scale effect
      scale.value = 1 - Math.abs(e.translationY) / 600;
      // More dramatic opacity fade
      opacity.value = 1 - Math.abs(e.translationY) / 500;
    })
    .onEnd(e => {
      // Lower threshold for easier swiping (was 100, now 50)
      const threshold = 50;
      if (e.translationY > threshold && hasNext) {
        // More dramatic exit animation
        translateY.value = withSpring(height * 1.2, {
          damping: 15,
          stiffness: 100,
        });
        rotateZ.value = withSpring(720, {
          damping: 15,
          stiffness: 100,
        });
        opacity.value = withTiming(0, { duration: 200 });
        runOnJS(goToNext)();
      } else if (e.translationY < -threshold && hasPrevious) {
        // More dramatic exit animation
        translateY.value = withSpring(-height * 1.2, {
          damping: 15,
          stiffness: 100,
        });
        rotateZ.value = withSpring(-720, {
          damping: 15,
          stiffness: 100,
        });
        opacity.value = withTiming(0, { duration: 200 });
        runOnJS(goToPrevious)();
      } else {
        // Snappy return animation
        translateY.value = withSpring(0, {
          damping: 20,
          stiffness: 150,
        });
        rotateZ.value = withSpring(0, {
          damping: 20,
          stiffness: 150,
        });
        scale.value = withSpring(1, {
          damping: 20,
          stiffness: 150,
        });
        opacity.value = withSpring(1, {
          damping: 20,
          stiffness: 150,
        });
      }
    });

  /* ────── PLAY ────── */
  const playSong = async (post: Post) => {
    if (openingId === post.id) return;
    setOpeningId(post.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let target = post.url;
    if (target.startsWith('spotify:')) {
      target = target.replace('spotify:', 'https://open.spotify.com/');
    }

    try {
      await Linking.openURL(target);
    } catch (e) {
      console.warn(e);
    } finally {
      setOpeningId(null);
    }
  };

  /* ────── PROFILE NAV ────── */
  const openProfile = (username: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('ProfileScreen', { username });
  };

  /* ────── DATE HELPERS ────── */
  const formatDate = (iso: string) => {
    if (!iso) return 'Just now';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Invalid date';
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${diff}d ago`;
  };

  /* ────── ANIMATED STYLES ────── */
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotateZ: `${rotateZ.value}deg` },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const frontFlipStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${flipRotation.value}deg` }],
  }));

  const backFlipStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${flipRotation.value + 180}deg` }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  /* ────── UI ────── */
  if (!token) {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={styles.loginBox}>
          <Text style={styles.logo}>Earshot</Text>
          <Text style={styles.slogan}>Share music. Follow friends.</Text>
          <TextInput
            placeholder="Username (optional - leave blank for auto-generated)"
            value={username}
            onChangeText={setUsername}
            style={styles.input}
            autoCapitalize="none"
            placeholderTextColor="#666"
          />
          <TouchableOpacity style={styles.button} onPress={() => login()}>
            <Text style={styles.buttonText}>CONTINUE</Text>
          </TouchableOpacity>
          <Text style={styles.hintText}>
            Leave blank to get a random username like "purple-bear-3488"
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (loading) {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#1DB954" />
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!currentPost) {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {feed.length === 0 ? 'No posts yet' : 'No post selected'}
          </Text>
          {feed.length > 0 && (
            <Text style={[styles.emptyText, { fontSize: 12, marginTop: 8 }]}>
              Feed has {feed.length} posts, but index {currentPostIndex} is out of range
            </Text>
          )}
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[styles.container, { paddingTop: insets.top, position: 'relative' }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.headerLeft} />
            <View style={styles.headerCenter}>
              <Text style={styles.logo}>Earshot</Text>
              <Text style={styles.slogan}>Share music. Follow friends.</Text>
            </View>
            <View style={styles.headerRight}>
              {currentUsername ? (
                <TouchableOpacity
                  style={styles.profileButton}
                  onPress={() => {
                    console.log('Profile icon pressed, navigating to:', currentUsername);
                    navigation.navigate('ProfileScreen', { username: currentUsername });
                  }}
                >
                  <Text style={styles.profileIcon}>👤</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.profileButtonPlaceholder} />
              )}
            </View>
          </View>
        </View>

        {/* Vinyl Record Stack */}
        <GestureHandlerRootView style={{ flex: 1 }}>
          <GestureDetector gesture={panGesture}>
            <View style={styles.vinylContainer}>
              <Animated.View style={[styles.vinylWrapper, animatedStyle]}>
                <TouchableWithoutFeedback onPress={toggleFlip}>
                  <View style={styles.flipContainer}>
                    <Animated.View style={[styles.flipFace, frontFlipStyle]}>
                      {/* Vinyl Record */}
                      <View style={styles.vinyl}>
                        {/* Album Art Center */}
                        <View style={styles.vinylCenter}>
                          <Image source={{ uri: currentPost.thumbnail }} style={styles.albumArt} resizeMode="cover" />
                        </View>

                        {/* Vinyl Grooves */}
                        <View style={styles.groove1} />
                        <View style={styles.groove2} />
                        <View style={styles.groove3} />

                        {/* Center Hole */}
                        <View style={styles.centerHole} />
                      </View>
                    </Animated.View>

                    <Animated.View style={[styles.flipFace, styles.flipBack, backFlipStyle]}>
                      <View style={styles.vinylBack}>
                        <Text style={styles.backPlaceholder}>Coming Soon</Text>
                      </View>
                    </Animated.View>
                  </View>
                </TouchableWithoutFeedback>

                {/* Info Overlay - Always visible, outside flip container */}
                <View style={styles.infoOverlay}>
                  <Text style={styles.title} numberOfLines={2}>
                    {currentPost.title}
                  </Text>
                  {showArtist && (
                    <Text style={styles.artist} numberOfLines={1}>
                      {currentPost.artist}
                    </Text>
                  )}
                  <TouchableOpacity onPress={() => openProfile(currentPost.username)}>
                    <Text style={styles.username}>@{currentPost.username}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.playButton}
                    onPress={() => playSong(currentPost)}
                    disabled={openingId === currentPost.id}
                  >
                    {openingId === currentPost.id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.playText}>▶ Play</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </Animated.View>

              {/* Listener Count - pulsing text with live dot */}
              <Animated.View style={[styles.listenerContainer, { bottom: 90 }, pulseStyle]}>
                <View style={styles.listenerRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.listenerText}>{listenerCount} listening...</Text>
                </View>
              </Animated.View>

              {/* Swipe Hint - positioned at the bottom */}
              {hasNext && (
                <View style={[styles.swipeHintContainer, { bottom: 50 }]}>
                  <Text style={styles.swipeHint}>↓ Swipe for next</Text>
                </View>
              )}
            </View>
          </GestureDetector>
        </GestureHandlerRootView>
      </View>
    </SafeAreaProvider>
  );
}

/* ────── STYLES ────── */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loginBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logo: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#1DB954',
    textAlign: 'center',
    marginBottom: 8,
  },
  slogan: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 40,
  },
  input: {
    backgroundColor: '#222',
    color: '#fff',
    width: '100%',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#1DB954',
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  hintText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 20,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    width: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  profileButtonPlaceholder: {
    width: 32,
    height: 32,
  },
  profileButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileIcon: {
    fontSize: 20,
    color: '#fff',
  },
  vinylContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 20,
    position: 'relative',
  },
  vinylWrapper: {
    width: VINYL_SIZE,
    height: VINYL_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipContainer: {
    width: VINYL_SIZE,
    height: VINYL_SIZE,
    position: 'relative',
  },
  flipFace: {
    width: '100%',
    height: '100%',
    backfaceVisibility: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipBack: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  vinyl: {
    width: VINYL_SIZE,
    height: VINYL_SIZE,
    borderRadius: VINYL_SIZE / 2,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderWidth: 2,
    borderColor: '#333',
  },
  vinylCenter: {
    width: VINYL_SIZE * 0.85,
    height: VINYL_SIZE * 0.85,
    borderRadius: (VINYL_SIZE * 0.85) / 2,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#1DB954',
  },
  albumArt: {
    width: '100%',
    height: '100%',
  },
  groove1: {
    position: 'absolute',
    width: VINYL_SIZE * 0.7,
    height: VINYL_SIZE * 0.7,
    borderRadius: (VINYL_SIZE * 0.7) / 2,
    borderWidth: 1,
    borderColor: '#222',
  },
  groove2: {
    position: 'absolute',
    width: VINYL_SIZE * 0.85,
    height: VINYL_SIZE * 0.85,
    borderRadius: (VINYL_SIZE * 0.85) / 2,
    borderWidth: 1,
    borderColor: '#222',
  },
  groove3: {
    position: 'absolute',
    width: VINYL_SIZE * 0.95,
    height: VINYL_SIZE * 0.95,
    borderRadius: (VINYL_SIZE * 0.95) / 2,
    borderWidth: 1,
    borderColor: '#222',
  },
  centerHole: {
    position: 'absolute',
    width: VINYL_SIZE * 0.08,
    height: VINYL_SIZE * 0.08,
    borderRadius: (VINYL_SIZE * 0.08) / 2,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#333',
  },
  vinylBack: {
    width: VINYL_SIZE,
    height: VINYL_SIZE,
    borderRadius: VINYL_SIZE / 2,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPlaceholder: {
    color: '#555',
    letterSpacing: 1,
    fontSize: 16,
    textTransform: 'uppercase',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: -160,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  artist: {
    color: '#aaa',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
  username: {
    color: '#1DB954',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 14,
  },
  playButton: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
  },
  playText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  swipeHintContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  swipeHint: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
  },
  listenerContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  listenerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1DB954',
  },
  listenerText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '300',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 10,
    alignItems: 'center',
  },
  progress: {
    color: '#666',
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
});
