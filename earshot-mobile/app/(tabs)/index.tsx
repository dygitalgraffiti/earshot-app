// app/(tabs)/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseMusicUrl as parseMusicUrlUtil } from '../../utils/urlParser';

// Max content width for iPad (centers content)
const MAX_CONTENT_WIDTH = 500;

const API_URL = 'https://earshot-app.onrender.com';

// Helper function for fetch with timeout and retry
const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeout: number = 10000,
  retries: number = 2
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Retry on timeout or network errors
    if (retries > 0 && (error.name === 'AbortError' || error.message?.includes('network'))) {
      console.log(`Retrying request (${retries} retries left)...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
      return fetchWithTimeout(url, options, timeout, retries - 1);
    }
    
    throw error;
  }
};

// Helper functions for URL extraction and parsing
const extractUrlFromText = (text: string): string => {
  // Simple URL extraction - looks for http/https URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : text.trim();
};

const parseMusicUrl = (url: string): { isValid: boolean; platform?: string; url?: string } => {
  // Use the proper URL parser utility that supports Spotify, Apple Music, and YouTube
  const parsed = parseMusicUrlUtil(url);
  if (parsed.isValid) {
    return { 
      isValid: true, 
      platform: parsed.platform, 
      url: parsed.url 
    };
  }
  return { isValid: false, url };
};

interface Post {
  id: number;
  title: string;
  artist: string;
  thumbnail: string;
  username: string;
  url: string;
  createdAt: string;
  save_count?: number;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  // Get screen dimensions using hook - more reliable in production builds
  const { width, height } = useWindowDimensions();

  // Detect iPad dynamically - more reliable in production builds
  // iPad typically has width >= 768 in portrait or >= 1024 in landscape
  const isTablet = Platform.OS === 'ios' && (width >= 768 || width >= 1024 || height >= 1024);
  
  // Constrain vinyl size for larger screens (max 400px on iPad, 75% width on phone)
  const VINYL_SIZE = isTablet 
    ? Math.min(400, width * 0.5) 
    : width * 0.75;

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
  const [feedType, setFeedType] = useState<'global' | 'following'>('global'); // Feed type: global or following

  // Check for last feed type when screen comes into focus (e.g., returning from profile)
  useFocusEffect(
    useCallback(() => {
      const checkLastFeedType = async () => {
        const lastFeedType = await AsyncStorage.getItem('lastFeedType');
        if (lastFeedType === 'following' && feedType !== 'following') {
          setFeedType('following');
          setCurrentPostIndex(0);
          if (token) {
            loadFeed(token, 'following');
          }
          // Clear it after using
          await AsyncStorage.removeItem('lastFeedType');
        }
      };
      checkLastFeedType();
    }, [token, feedType])
  );
  const [isSaved, setIsSaved] = useState(false); // Track if current post is saved to crate
  const [saving, setSaving] = useState(false); // Track if save operation is in progress
  const [postSaveCounts, setPostSaveCounts] = useState<Record<number, number>>({}); // Random save counts per post (1-25)
  const [activeListeners, setActiveListeners] = useState(5); // Random active listeners (1-10)
  const [showShareModal, setShowShareModal] = useState(false); // Share modal visibility

  // Animation values
  const translateY = useSharedValue(0);
  const rotateZ = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const currentFeedType = useSharedValue<'global' | 'following'>('global');
  const flipRotation = useSharedValue(0);
  const pulseOpacity = useSharedValue(0.4);
  const horizontalTranslate = useSharedValue(0); // For preview effect during swipe
  
  // Store screen dimensions in shared values for use in worklets
  const screenWidth = useSharedValue(width);
  const screenHeight = useSharedValue(height);
  
  // Update shared values when dimensions change
  useEffect(() => {
    screenWidth.value = width;
    screenHeight.value = height;
  }, [width, height]);

  // Load token on mount and handle share intents
  useEffect(() => {
    // Ensure flip starts on front
    setIsFlipped(false);
    flipRotation.value = 0;
    
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
          // Try to load feed - if it fails with 401, token will be cleared
          // For other errors, keep the token and show feed (user can retry)
          try {
            await loadFeed(savedToken);
          } catch (error) {
            // If loadFeed fails but token wasn't cleared (non-401 error),
            // still show the feed so user can retry without logging in again
            console.log('Feed load failed on init, but keeping token:', error);
            setLoading(false);
            // Don't clear token on network errors - let user retry
          }
        } else {
          // No saved token - show login screen and wait for user action
          setLoading(false);
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

  // Debug: Log feedType changes and sync shared value
  useEffect(() => {
    console.log('feedType changed to:', feedType);
    currentFeedType.value = feedType; // Update shared value when state changes
    // Reset horizontal translation when feed type changes
    horizontalTranslate.value = 0;
  }, [feedType]);

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
      if (parsed.url) {
        setUrl(parsed.url);
      }
      
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
  const saveCount = currentPost?.save_count || 0;
  // Get random save count for this post (1-25)
  const displaySaveCount = currentPost ? (postSaveCounts[currentPost.id] || 0) : 0;

  // Calculate dynamic bottom position based on title length
  const calculateInfoOverlayBottom = () => {
    if (!currentPost) return -240;
    const titleLength = currentPost.title?.length || 0;
    const basePosition = -200; // Base position for short titles
    
    // Estimate space needed: longer titles need more space
    // Rough estimate: ~40 characters per line, 2 lines max
    // Add extra space for very long titles
    let extraSpace = 0;
    if (titleLength > 60) {
      // Very long titles (like "Big Sean - Supa Dupa (Official Music Video) Team Money iceman")
      extraSpace = -60;
    } else if (titleLength > 40) {
      // Medium-long titles
      extraSpace = -30;
    } else if (titleLength > 25) {
      // Medium titles
      extraSpace = -10;
    }
    // else short titles stay at base position
    
    // Add space if artist is shown
    const artistSpace = showArtist ? -20 : 0;
    
    return basePosition + extraSpace + artistSpace;
  };

  // Debug: Log when component renders
  useEffect(() => {
    console.log('HomeScreen rendered, feed length:', feed.length, 'currentIndex:', currentPostIndex);
  }, [feed.length, currentPostIndex]);

  // Update listener count randomly every 3-7 seconds (for main feed)
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

  // Update active listeners for vinyl back (1-10, changing)
  useEffect(() => {
    const updateActiveListeners = () => {
      const newCount = Math.floor(Math.random() * 10) + 1; // 1-10
      setActiveListeners(newCount);
    };

    // Initial count
    updateActiveListeners();

    // Update at random intervals between 2-5 seconds
    const scheduleUpdate = () => {
      const delay = Math.random() * 3000 + 2000; // 2000-5000ms
      setTimeout(() => {
        updateActiveListeners();
        scheduleUpdate();
      }, delay);
    };
    scheduleUpdate();
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
    // Immediately set to 0, don't animate the reset
    flipRotation.value = 0;
    // Generate random save count for new post if not already generated
    if (currentPost && !postSaveCounts[currentPost.id]) {
      const randomCount = Math.floor(Math.random() * 25) + 1;
      setPostSaveCounts(prev => ({ ...prev, [currentPost.id]: randomCount }));
    }
  }, [currentPostIndex, currentPost?.id]);

  const toggleFlip = () => {
    const next = !isFlipped;
    setIsFlipped(next);
    // Animate rotation smoothly with spring for more dramatic effect
    const targetRotation = next ? 180 : 0;
    flipRotation.value = withSpring(targetRotation, {
      damping: 15,
      stiffness: 100,
      mass: 1,
    });
    console.log('Toggle flip:', next, 'target rotation:', targetRotation);
  };

  /* ────── AUTH ────── */
  const fetchCurrentUsername = async (t: string) => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${t}` },
      }, 10000, 2);
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
      
      const res = await fetchWithTimeout(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }, 15000, 2);
      
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

  const loadFeed = async (t: string, type: 'global' | 'following' = feedType) => {
    try {
      setLoading(true);
      const res = await fetchWithTimeout(`${API_URL}/api/feed?type=${type}`, {
        headers: { Authorization: `Bearer ${t}` },
      }, 15000, 2);
      
      if (!res.ok) {
        if (res.status === 401) {
          // Token expired, clear it silently
          console.log('Token expired, clearing auth');
          await AsyncStorage.removeItem('authToken');
          setToken(null);
          setFeed([]);
          setLoading(false); // Make sure to set loading to false
          // Don't show alert here - let user continue using app
          // They'll see login screen on next interaction
          return;
        }
        
        // Handle 502 Bad Gateway (server down/spinning up)
        if (res.status === 502 || res.status === 503) {
          console.error('Server unavailable (502/503), showing error');
          Alert.alert(
            'Server Unavailable',
            'The server is starting up. Please try again in a few moments.',
            [{ text: 'OK', onPress: () => setLoading(false) }]
          );
          setFeed([]);
          setLoading(false);
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
    } catch (e: any) {
      console.error('Feed error:', e);
      
      // Handle timeout/network errors
      if (e.name === 'AbortError' || e.message?.includes('timeout') || e.message?.includes('network')) {
        // Don't show alert on initial load - just keep existing feed or empty state
        // User can pull to refresh or try again
        console.log('Network error loading feed, keeping existing state');
        // Only show alert if we're not in initial load (feed is empty means initial load)
        if (feed.length > 0) {
          Alert.alert(
            'Connection Timeout',
            'The server is taking too long to respond. This might be because it\'s starting up. Please try again.',
            [{ text: 'OK' }]
          );
        }
      } else {
        // Only show alert if we have existing feed (not initial load)
        if (feed.length > 0) {
          Alert.alert('Feed Error', `Could not load posts: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
      
      // Don't clear feed on error - keep existing feed if available
      // Only clear if this was initial load (feed is empty)
      if (feed.length === 0) {
        setFeed([]);
      }
      setLoading(false); // Ensure loading is set to false on error
    } finally {
      setLoading(false); // Double ensure loading is always set to false
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
      const res = await fetchWithTimeout(`${API_URL}/api/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: url.trim() }),
      }, 15000, 2);
      
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

  /* ────── CRATE FUNCTIONS ────── */
  const handleSaveToCrate = async () => {
    if (!currentPost || !token || saving) return;
    
    setSaving(true);
    try {
      const method = isSaved ? 'DELETE' : 'POST';
      const response = await fetchWithTimeout(`${API_URL}/api/crate/${currentPost.id}`, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }, 10000, 2);
      
      if (response.ok) {
        const data = await response.json();
        setIsSaved(!isSaved);
        // Update save count in feed
        const updatedFeed = feed.map(p => 
          p.id === currentPost.id ? { ...p, save_count: data.save_count } : p
        );
        setFeed(updatedFeed);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        Alert.alert('Error', 'Failed to save to crate');
      }
    } catch (error) {
      console.error('Crate error:', error);
      Alert.alert('Error', 'Failed to save to crate');
    } finally {
      setSaving(false);
    }
  };

  // Reset saved state when post changes
  useEffect(() => {
    setIsSaved(false); // Will be updated when we check user's crate
  }, [currentPost?.id]);

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
  // Functions to switch feeds (need to be defined before gesture)
  const switchToFollowing = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFeedType('following');
      setCurrentPostIndex(0);
      if (token) {
        loadFeed(token, 'following');
      }
    } catch (error) {
      console.error('Error switching to following:', error);
    }
  };

  const switchToGlobal = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFeedType('global');
      setCurrentPostIndex(0);
      if (token) {
        loadFeed(token, 'global');
      }
    } catch (error) {
      console.error('Error switching to global:', error);
    }
  };

  const navigateToProfile = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (currentUsername) {
        navigation.navigate('ProfileScreen', { username: currentUsername });
      }
    } catch (error) {
      console.error('Error navigating to profile:', error);
    }
  };

  // Horizontal swipe gesture for switching feeds with preview effect
  const horizontalPanGesture = Gesture.Pan()
    .activeOffsetX([-10, 10]) // Only activate if horizontal movement is significant
    .failOffsetY([-15, 15]) // Fail if vertical movement is too large (prioritize vertical swipe)
    .onUpdate(e => {
      'worklet';
      // Check if this is clearly a horizontal swipe (horizontal movement > vertical movement)
      const isHorizontal = Math.abs(e.translationX) > Math.abs(e.translationY) * 1.5;
      if (isHorizontal) {
        // Update translation for preview effect - limit to screen width
        const maxTranslate = screenWidth.value * 0.8; // Max 80% of screen width
        horizontalTranslate.value = Math.max(-maxTranslate, Math.min(maxTranslate, e.translationX));
      }
    })
    .onEnd(e => {
      'worklet';
      const threshold = 80; // Minimum swipe distance
      // Only trigger if horizontal movement is clearly dominant
      const isHorizontal = Math.abs(e.translationX) > Math.abs(e.translationY) * 1.5;
      if (!isHorizontal) {
        // Reset translation if not horizontal
        horizontalTranslate.value = withSpring(0, {
          damping: 20,
          stiffness: 300,
        });
        return;
      }
      const feedTypeValue = currentFeedType.value; // Get current feed type from shared value
      if (e.translationX < -threshold && feedTypeValue === 'global') {
        // Swipe left on global feed → switch to following
        horizontalTranslate.value = withSpring(-screenWidth.value, {
          damping: 15,
          stiffness: 200,
        });
        runOnJS(switchToFollowing)();
        // Reset after switch
        setTimeout(() => {
          'worklet';
          horizontalTranslate.value = 0;
        }, 300);
      } else if (e.translationX < -threshold && feedTypeValue === 'following') {
        // Swipe left on following feed → navigate to profile
        horizontalTranslate.value = withSpring(-screenWidth.value, {
          damping: 15,
          stiffness: 200,
        });
        runOnJS(navigateToProfile)();
        // Reset after navigation
        setTimeout(() => {
          'worklet';
          horizontalTranslate.value = 0;
        }, 300);
      } else if (e.translationX > threshold && feedTypeValue === 'following') {
        // Swipe right on following feed → switch to global
        horizontalTranslate.value = withSpring(screenWidth.value, {
          damping: 15,
          stiffness: 200,
        });
        runOnJS(switchToGlobal)();
        // Reset after switch
        setTimeout(() => {
          'worklet';
          horizontalTranslate.value = 0;
        }, 300);
      } else {
        // Return to original position with smooth spring
        horizontalTranslate.value = withSpring(0, {
          damping: 20,
          stiffness: 300,
        });
      }
    });

  // Tap gesture for flipping the vinyl - use long press to avoid conflicts with pan
  const tapGesture = Gesture.Tap()
    .maxDuration(300)
    .maxDistance(10)
    .onEnd(() => {
      'worklet';
      runOnJS(toggleFlip)();
    });

  const panGesture = Gesture.Pan()
    .activeOffsetY([-10, 10]) // Only activate if vertical movement is significant
    .failOffsetX([-20, 20]) // Fail if horizontal movement is too large (prioritize horizontal swipe for feed switching)
    .onUpdate(e => {
      'worklet';
      // Only apply rotation if this is clearly a vertical swipe
      const isVertical = Math.abs(e.translationY) > Math.abs(e.translationX) * 1.5;
      if (isVertical) {
        translateY.value = e.translationY;
        // More dramatic rotation for swooshing effect (only when vertical)
        rotateZ.value = e.translationX * 0.2;
        // More pronounced scale effect
        scale.value = 1 - Math.abs(e.translationY) / 600;
        // More dramatic opacity fade
        opacity.value = 1 - Math.abs(e.translationY) / 500;
      }
    })
    .onEnd(e => {
      'worklet';
      // Only process if this is clearly a vertical swipe
      const isVertical = Math.abs(e.translationY) > Math.abs(e.translationX) * 1.5;
      if (!isVertical) {
        // If it's more horizontal, let the horizontal gesture handle it
        translateY.value = withSpring(0);
        rotateZ.value = withSpring(0);
        scale.value = withSpring(1);
        opacity.value = withSpring(1);
        return;
      }
      // Lower threshold for easier swiping (was 100, now 50)
      const threshold = 50;
      if (e.translationY > threshold && hasNext) {
        // More dramatic exit animation
        translateY.value = withSpring(screenHeight.value * 1.2, {
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
        translateY.value = withSpring(-screenHeight.value * 1.2, {
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

  const frontFlipStyle = useAnimatedStyle(() => {
    const rotation = flipRotation.value;
    // Front visible when rotation < 90, hidden when >= 90
    const frontOpacity = rotation < 90 ? 1 : 0;
    return {
      transform: [
        { perspective: 1000 },
        { rotateY: `${rotation}deg` }
      ],
      opacity: frontOpacity,
    };
  });

  const backFlipStyle = useAnimatedStyle(() => {
    const rotation = flipRotation.value;
    // Back visible when rotation >= 90, hidden when < 90
    const backOpacity = rotation >= 90 ? 1 : 0;
    return {
      transform: [
        { perspective: 1000 },
        { rotateY: `${rotation + 180}deg` }
      ],
      opacity: backOpacity,
    };
  });

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  // Animated style for horizontal preview effect
  const horizontalPreviewStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: horizontalTranslate.value }],
  }));

  /* ────── UI ────── */
  if (!token) {
    const loginContent = (
      <>
        <Text style={[styles.logo, isTablet && { fontSize: 48 }]}>Earshot</Text>
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
      </>
    );

    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={[styles.loginBox, isTablet && styles.loginBoxTablet]}>
          {isTablet ? (
            <View style={{ maxWidth: 400, width: '100%', alignSelf: 'center' }}>
              {loginContent}
            </View>
          ) : (
            loginContent
          )}
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

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={horizontalPanGesture}>
          <Animated.View style={[
            styles.container, 
            { paddingTop: insets.top, position: 'relative' }, 
            horizontalPreviewStyle,
            isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%' }
          ]}>
            {/* Header */}
            <View style={[styles.header, isTablet && styles.headerTablet]} key={`header-${feedType}`}>
          <View style={styles.headerContent}>
            <View style={styles.headerLeft}>
              {/* Back button removed - use swipe right to go back */}
        </View>
            <View style={styles.headerCenter}>
              <Text style={[styles.logo, isTablet && { fontSize: 48 }]}>Earshot</Text>
              <View style={styles.feedTabs}>
                <TouchableOpacity
                  style={[styles.feedTab, feedType === 'global' && styles.feedTabActive]}
                  onPress={() => {
                    setFeedType('global');
                    setCurrentPostIndex(0);
                    if (token) {
                      loadFeed(token, 'global');
                    }
                  }}
                >
                  <Text style={[styles.feedTabText, feedType === 'global' && styles.feedTabTextActive]}>
                    Global Feed
                  </Text>
                </TouchableOpacity>
                <Text style={styles.feedTabDivider}>|</Text>
                <TouchableOpacity
                  style={[styles.feedTab, feedType === 'following' && styles.feedTabActive]}
                  onPress={() => {
                    console.log('Following tab pressed, switching to following feed');
                    setFeedType('following');
                    setCurrentPostIndex(0);
                    if (token) {
                      loadFeed(token, 'following');
                    }
                  }}
                >
                  <Text style={[styles.feedTabText, feedType === 'following' && styles.feedTabTextActive]}>
                    Following
                        </Text>
                </TouchableOpacity>
              </View>
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
        {!currentPost ? (
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
        ) : (
          <GestureDetector gesture={panGesture}>
            <View style={styles.vinylContainer}>
              <Animated.View style={[{ width: VINYL_SIZE, height: VINYL_SIZE, justifyContent: 'center', alignItems: 'center' }, animatedStyle]}>
                <GestureDetector gesture={tapGesture}>
                  <View style={{ width: VINYL_SIZE, height: VINYL_SIZE, position: 'relative' }}>
                    {/* Back face - render first (behind) */}
                    <Animated.View style={[styles.flipFace, styles.flipBack, backFlipStyle]}>
                      <View style={{
                        width: VINYL_SIZE,
                        height: VINYL_SIZE,
                        borderRadius: VINYL_SIZE / 2,
                        backgroundColor: '#111',
                        borderWidth: 2,
                        borderColor: '#333',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'visible',
                      }}>
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.7,
                          height: VINYL_SIZE * 0.7,
                          borderRadius: (VINYL_SIZE * 0.7) / 2,
                          borderWidth: 1,
                          borderColor: '#222',
                        }} />
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.85,
                          height: VINYL_SIZE * 0.85,
                          borderRadius: (VINYL_SIZE * 0.85) / 2,
                          borderWidth: 1,
                          borderColor: '#222',
                        }} />
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.95,
                          height: VINYL_SIZE * 0.95,
                          borderRadius: (VINYL_SIZE * 0.95) / 2,
                          borderWidth: 1,
                          borderColor: '#222',
                        }} />
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.08,
                          height: VINYL_SIZE * 0.08,
                          borderRadius: (VINYL_SIZE * 0.08) / 2,
                          backgroundColor: '#000',
                          borderWidth: 1,
                          borderColor: '#333',
                        }} />
                        {currentPost && (
                          <View style={{
                            position: 'absolute',
                            top: VINYL_SIZE * 0.35,
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '100%',
                            paddingHorizontal: 20,
                          }}>
                            {/* Stats text - simple and readable */}
                            <View style={styles.curvedTextWrapper}>
                              <View style={styles.curvedTextRow}>
                                <Text style={styles.curvedText} numberOfLines={1}>
                                  {displaySaveCount} Saved to Crate
                                </Text>
                              </View>
                              <View style={styles.curvedTextRow}>
                                <Text style={styles.curvedText} numberOfLines={1}>
                                  {activeListeners} Active Listeners
                                </Text>
                              </View>
                            </View>
                            {/* Save button */}
                            <TouchableOpacity
                              style={[styles.crateButton, isSaved && styles.crateButtonSaved]}
                              onPress={handleSaveToCrate}
                              disabled={saving}
                            >
                              <Text style={styles.crateButtonText} numberOfLines={1}>
                                {saving ? '...' : isSaved ? '✓ Saved' : 'Save to Crate'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </Animated.View>
                    
                    {/* Front face - render last (on top) */}
                    <Animated.View style={[styles.flipFace, frontFlipStyle]}>
                      <View style={{
                        width: VINYL_SIZE,
                        height: VINYL_SIZE,
                        borderRadius: VINYL_SIZE / 2,
                        backgroundColor: '#111',
                        justifyContent: 'center',
                        alignItems: 'center',
                        position: 'relative',
                        borderWidth: 2,
                        borderColor: '#333',
                      }}>
                        <View style={{
                          width: VINYL_SIZE * 0.85,
                          height: VINYL_SIZE * 0.85,
                          borderRadius: (VINYL_SIZE * 0.85) / 2,
                          overflow: 'hidden',
                          backgroundColor: '#000',
                          borderWidth: 3,
                          borderColor: '#1DB954',
                        }}>
                          <Image source={{ uri: currentPost.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        </View>
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.7,
                          height: VINYL_SIZE * 0.7,
                          borderRadius: (VINYL_SIZE * 0.7) / 2,
                          borderWidth: 1,
                          borderColor: '#222',
                        }} />
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.85,
                          height: VINYL_SIZE * 0.85,
                          borderRadius: (VINYL_SIZE * 0.85) / 2,
                          borderWidth: 1,
                          borderColor: '#222',
                        }} />
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.95,
                          height: VINYL_SIZE * 0.95,
                          borderRadius: (VINYL_SIZE * 0.95) / 2,
                          borderWidth: 1,
                          borderColor: '#222',
                        }} />
                        <View style={{
                          position: 'absolute',
                          width: VINYL_SIZE * 0.08,
                          height: VINYL_SIZE * 0.08,
                          borderRadius: (VINYL_SIZE * 0.08) / 2,
                          backgroundColor: '#000',
                          borderWidth: 1,
                          borderColor: '#333',
                        }} />
                      </View>
                    </Animated.View>
                  </View>
                </GestureDetector>

                {/* Info Overlay - Always visible, outside flip container */}
                <View style={[styles.infoOverlay, { bottom: calculateInfoOverlayBottom() }, isTablet && { paddingHorizontal: 40 }]}>
                  <Text style={[styles.title, isTablet && { fontSize: 24 }]} numberOfLines={2}>
                    {currentPost.title}
                  </Text>
                  {showArtist && (
                    <Text style={[styles.artist, isTablet && { fontSize: 18 }]} numberOfLines={1}>
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
                  <TouchableOpacity
                    style={styles.shareButtonInline}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowShareModal(true);
                    }}
                  >
                    <Text style={styles.shareButtonTextInline}>Paste Link to Share</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>

              {/* Listener Count - pulsing text with live dot */}
              <Animated.View style={[
                styles.listenerContainer, 
                { bottom: isTablet ? 140 : 90 }, 
                pulseStyle
              ]}>
                <View style={styles.listenerRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.listenerText}>{listenerCount} listening...</Text>
                </View>
              </Animated.View>

              {/* Swipe Hint - positioned at the bottom */}
              {hasNext && (
                <View style={[styles.swipeHintContainer, { bottom: isTablet ? 100 : 50 }]}>
                  <Text style={styles.swipeHint}>↓ Swipe for next</Text>
                </View>
              )}
            </View>
          </GestureDetector>
        )}
          </Animated.View>
        </GestureDetector>

        {/* Share Modal */}
        <Modal
          visible={showShareModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowShareModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, isTablet && styles.modalContentTablet]}>
              <Text style={styles.modalTitle}>Share Music</Text>
              <Text style={styles.modalSubtitle}>Paste a Spotify, Apple Music, or YouTube link</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="https://open.spotify.com/track/..."
                placeholderTextColor="#666"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                multiline={false}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={() => {
                    setShowShareModal(false);
                    setUrl('');
                  }}
                >
                  <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonShare]}
                  onPress={async () => {
                    if (!url.trim()) {
                      Alert.alert('Empty URL', 'Please enter a URL to share');
                      return;
                    }
                    // Validate URL
                    const parsed = parseMusicUrl(url.trim());
                    if (!parsed.isValid) {
                      Alert.alert('Invalid URL', 'Please enter a valid Spotify, Apple Music, or YouTube link');
                      return;
                    }
                    setShowShareModal(false);
                    await postTrack();
                  }}
                >
                  <Text style={styles.modalButtonTextShare}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </GestureHandlerRootView>
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
  loginBoxTablet: {
    padding: 40,
  },
  logo: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#1DB954',
    textAlign: 'center',
    marginBottom: 8,
  },
  feedTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  feedTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  feedTabActive: {
    // Active state styling handled by text color
  },
  feedTabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  feedTabTextActive: {
    color: '#1DB954',
    fontWeight: 'bold',
  },
  feedTabDivider: {
    fontSize: 14,
    color: '#444',
    marginHorizontal: 8,
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
  headerTablet: {
    paddingHorizontal: 40,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingTop: 10,
    minHeight: 36,
    backgroundColor: 'transparent',
  },
  headerLeftPlaceholder: {
    width: 36,
    height: 36,
  },
  backButton: {
    width: 80,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 1000,
    elevation: 10,
    position: 'relative',
  },
  backButtonActive: {
    opacity: 1,
  },
  backButtonInactive: {
    opacity: 0.3,
  },
  backButtonText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: 'bold',
    lineHeight: 14,
    textAlign: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 10,
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
    width: '100%',
  },
  flipFace: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  flipBack: {
    // Back face - positioned absolutely, opacity controls visibility
  },
  backPlaceholder: {
    color: '#555',
    letterSpacing: 1,
    fontSize: 16,
    textTransform: 'uppercase',
    marginTop: 40,
  },
  curvedTextWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  curvedTextRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  curvedTextRowTop: {
    // Simple positioning, no complex transforms that cause clipping
  },
  curvedTextRowBottom: {
    // Simple positioning, no complex transforms that cause clipping
  },
  curvedText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    paddingHorizontal: 15,
  },
  crateButton: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#fff',
    minWidth: 140,
    maxWidth: '90%', // Prevent button from going off screen
    alignSelf: 'center',
  },
  crateButtonSaved: {
    backgroundColor: '#333',
  },
  crateButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  saveCount: {
    color: '#888',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: -240,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 1,
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
    marginBottom: 12,
  },
  playText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  shareButtonInline: {
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#555',
  },
  shareButtonTextInline: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  swipeHintContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
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
    zIndex: 100,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 2,
    borderColor: '#333',
  },
  modalContentTablet: {
    maxWidth: 500,
    padding: 32,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#222',
    color: '#fff',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#555',
  },
  modalButtonShare: {
    backgroundColor: '#1DB954',
    borderWidth: 2,
    borderColor: '#fff',
  },
  modalButtonTextCancel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextShare: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
