// app/(tabs)/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { AnimatePresence, MotiView } from 'moti';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Image,
    Linking,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');
const VINYL_SIZE = Math.min(width * 0.85, height * 0.5);
const VINYL_CENTER_HOLE = VINYL_SIZE * 0.15;

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
  const [password, setPassword] = useState('');
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [currentTrack, setCurrentTrack] = useState<Post | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const miniPlayerAnim = useRef(new Animated.Value(0)).current;

  // Animation values for vinyl stack
  const translateY = useSharedValue(0);
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  /* ────── LOAD TOKEN ON MOUNT ────── */
  useEffect(() => {
    const loadStoredToken = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('auth_token');
        if (storedToken) {
          setToken(storedToken);
          loadFeed(storedToken);
        }
      } catch (e) {
        console.warn('Failed to load token:', e);
      }
    };
    loadStoredToken();
  }, []);

  /* ────── AUTH ────── */
  const login = async () => {
    if (!username || !password) {
      Alert.alert('Missing', 'Please fill in both fields');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        await AsyncStorage.setItem('auth_token', data.token);
        loadFeed(data.token);
      } else {
        Alert.alert('Login Failed', data.error || 'Try again');
      }
    } catch {
      Alert.alert('Network Error', 'Check your connection');
    }
  };

  const loadFeed = async (t: string) => {
    try {
      const res = await fetch(`${API_URL}/api/feed`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = await res.json();
      console.log('Feed loaded:', data.length, 'posts');
      setFeed(data);
      setCurrentIndex(0);
    } catch {
      Alert.alert('Feed Error', 'Could not load posts');
    }
  };

  const postTrack = async () => {
    if (!url.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token!}`,
        },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        Alert.alert('Posted!', `${data.post.title}`);
        setUrl('');
        loadFeed(token!);
      }
    } catch {
      Alert.alert('Post Failed', 'Try again');
    }
  };

  const toggleFlip = (id: number) => {
    setFlipped(prev => ({ ...prev, [id]: !prev[id] }));
  };

  /* ────── NAVIGATION ────── */
  const goToNext = () => {
    if (currentIndex < feed.length - 1) {
      setCurrentIndex(prev => prev + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  // Reset animation when index changes
  useEffect(() => {
    translateY.value = 0;
    rotation.value = 0;
    scale.value = 1;
    opacity.value = 1;
  }, [currentIndex]);

  /* ────── PLAY ────── */
  const playSong = async (post: Post) => {
    if (openingId === post.id) return;
    setOpeningId(post.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    let target = post.url;
    if (target.startsWith('spotify:')) {
      target = target.replace('spotify:', 'https://open.spotify.com/');
    }

    try {
      await Linking.openURL(target);
      setCurrentTrack(post);
      setIsPlaying(true);
      Animated.timing(miniPlayerAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();

      setTimeout(() => {
        if (currentTrack?.id === post.id) closePlayer();
      }, 30_000);
    } catch (e) {
      console.warn(e);
    } finally {
      setOpeningId(null);
    }
  };

  const togglePlayPause = () => {
    setIsPlaying(p => !p);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const closePlayer = () => {
    Animated.timing(miniPlayerAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
      setCurrentTrack(null);
      setIsPlaying(false);
    });
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

  /* ────── GESTURE HANDLING ────── */
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = e.translationY;
      // Add rotation based on horizontal movement for vinyl feel
      rotation.value = e.translationX * 0.1;
      // Scale down slightly when dragging
      const absTranslation = Math.abs(e.translationY);
      const maxTranslation = height * 0.3;
      scale.value = absTranslation > maxTranslation ? 0.9 : 1 - (absTranslation / maxTranslation) * 0.1;
    })
    .onEnd((e) => {
      const threshold = height * 0.15;
      const velocity = e.velocityY;

      if (e.translationY > threshold || velocity > 1000) {
        // Swipe down - next record
        translateY.value = withTiming(height, { duration: 300 });
        opacity.value = withTiming(0, { duration: 300 });
        runOnJS(goToNext)();
      } else if (e.translationY < -threshold || velocity < -1000) {
        // Swipe up - previous record
        translateY.value = withTiming(-height, { duration: 300 });
        opacity.value = withTiming(0, { duration: 300 });
        runOnJS(goToPrevious)();
      } else {
        // Spring back to center
        translateY.value = withSpring(0);
        rotation.value = withSpring(0);
        scale.value = withSpring(1);
      }
    });

  const animatedCardStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: translateY.value },
        { rotateZ: `${rotation.value}deg` },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    };
  });

  /* ────── UI ────── */
  if (!token) {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={styles.loginBox}>
          <Text style={styles.logo}>Earshot</Text>
          <Text style={styles.slogan}>Share music. Follow friends.</Text>
          <TextInput placeholder="Username" value={username} onChangeText={setUsername} style={styles.input} autoCapitalize="none" />
          <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
          <TouchableOpacity style={styles.button} onPress={login}>
            <Text style={styles.buttonText}>LOGIN</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaProvider>
    );
  }

  const currentPost = feed[currentIndex];
  const hasNext = currentIndex < feed.length - 1;
  const hasPrevious = currentIndex > 0;

  // Debug logging
  useEffect(() => {
    console.log('Feed state:', {
      feedLength: feed.length,
      currentIndex,
      hasCurrentPost: !!currentPost,
    });
  }, [feed, currentIndex, currentPost]);

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.logo}>Earshot</Text>
          <Text style={styles.slogan}>Share music. Follow friends.</Text>
        </View>

        <View style={styles.postBox}>
          <TextInput placeholder="Paste YouTube/Spotify link..." value={url} onChangeText={setUrl} style={styles.input} />
          <TouchableOpacity style={styles.postBtn} onPress={postTrack}>
            <Text style={styles.postBtnText}>POST</Text>
          </TouchableOpacity>
        </View>

        {/* VINYL RECORD STACK */}
        {feed.length > 0 && currentPost ? (
          <View style={styles.vinylContainer}>
            {/* Next record preview (behind current) */}
            {hasNext && feed[currentIndex + 1] && (
              <View style={[styles.vinylStack, styles.vinylBehind]}>
                <View style={styles.vinylRecord}>
                  <Image
                    source={{ uri: feed[currentIndex + 1].thumbnail }}
                    style={styles.vinylImage}
                  />
                  <View style={styles.vinylCenterHole} />
                </View>
              </View>
            )}

            {/* Current record */}
            <GestureDetector gesture={panGesture}>
              <Reanimated.View style={[styles.vinylStack, animatedCardStyle]}>
                <TouchableOpacity
                  onPress={() => toggleFlip(currentPost.id)}
                  activeOpacity={0.95}
                  style={styles.vinylTouchable}
                >
                  <View style={styles.vinylRecord}>
                    <AnimatePresence>
                      {!flipped[currentPost.id] ? (
                        <MotiView
                          key={`front-${currentPost.id}`}
                          from={{ rotateY: '0deg' }}
                          animate={{ rotateY: '0deg' }}
                          exit={{ rotateY: '-90deg' }}
                          transition={{ type: 'timing', duration: 300 }}
                          style={styles.vinylFront}
                        >
                          <Image
                            source={{ uri: currentPost.thumbnail }}
                            style={styles.vinylImage}
                          />
                          <View style={styles.vinylCenterHole} />
                          <View style={styles.vinylGrooves}>
                            {[...Array(8)].map((_, i) => (
                              <View
                                key={i}
                                style={[
                                  styles.groove,
                                  {
                                    width: VINYL_SIZE * (0.3 + i * 0.05),
                                    height: VINYL_SIZE * (0.3 + i * 0.05),
                                  },
                                ]}
                              />
                            ))}
                          </View>
                        </MotiView>
                      ) : (
                        <MotiView
                          key={`back-${currentPost.id}`}
                          from={{ rotateY: '90deg' }}
                          animate={{ rotateY: '0deg' }}
                          transition={{ type: 'timing', duration: 300 }}
                          style={styles.vinylBack}
                        >
                          <View style={styles.vinylBackContent}>
                            <Text style={styles.backTitle} numberOfLines={2}>
                              {currentPost.title}
                            </Text>
                            <Text style={styles.backArtist}>{currentPost.artist}</Text>
                            <TouchableOpacity
                              style={styles.playButton}
                              onPress={() => playSong(currentPost)}
                              disabled={openingId === currentPost.id}
                            >
                              {openingId === currentPost.id ? (
                                <ActivityIndicator color="#fff" />
                              ) : (
                                <Text style={styles.playText}>Play in App</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                          <View style={styles.vinylCenterHole} />
                        </MotiView>
                      )}
                    </AnimatePresence>
                  </View>
                </TouchableOpacity>

                {/* USER + TIME BELOW */}
                <View style={styles.cardFooter}>
                  <TouchableOpacity onPress={() => openProfile(currentPost.username)}>
                    <Text style={styles.footerUsername}>@{currentPost.username}</Text>
                  </TouchableOpacity>
                  <Text style={styles.footerTime}>{formatDate(currentPost.createdAt)}</Text>
                </View>

                {/* Swipe hints */}
                <View style={styles.swipeHints}>
                  {hasPrevious && (
                    <View style={styles.swipeHint}>
                      <Text style={styles.swipeHintText}>↑ Previous</Text>
                    </View>
                  )}
                  {hasNext && (
                    <View style={styles.swipeHint}>
                      <Text style={styles.swipeHintText}>↓ Next</Text>
                    </View>
                  )}
                </View>
              </Reanimated.View>
            </GestureDetector>

            {/* Progress indicator */}
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>
                {currentIndex + 1} / {feed.length}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No posts yet</Text>
          </View>
        )}

        {/* MINI‑PLAYER */}
        {currentTrack && (
          <Animated.View
            style={[
              styles.miniPlayer,
              {
                transform: [
                  {
                    translateY: miniPlayerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [100, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Image source={{ uri: currentTrack.thumbnail }} style={styles.miniArt} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.miniTitle} numberOfLines={1}>
                {currentTrack.title}
              </Text>
              <Text style={styles.miniArtist} numberOfLines={1}>
                {isPlaying ? 'Now playing' : 'Paused'} • {currentTrack.artist}
              </Text>
            </View>
            <TouchableOpacity onPress={togglePlayPause}>
              <Text style={styles.miniPlay}>{isPlaying ? 'Pause' : 'Play'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={closePlayer} style={{ marginLeft: 16 }}>
              <Text style={styles.miniClose}>×</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

/* ────── STYLES ────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loginBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  logo: { fontSize: 48, fontWeight: 'bold', color: '#1DB954', textAlign: 'center', marginBottom: 8 },
  slogan: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 40 },
  input: { backgroundColor: '#222', color: '#fff', width: '100%', padding: 16, borderRadius: 12, marginBottom: 16, fontSize: 16 },
  button: { backgroundColor: '#1DB954', width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  header: { padding: 20, alignItems: 'center' },
  postBox: { paddingHorizontal: 20, marginBottom: 16 },
  postBtn: { backgroundColor: '#1DB954', padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  postBtnText: { color: '#fff', fontWeight: 'bold' },

  // Vinyl stack styles
  vinylContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  vinylStack: {
    width: VINYL_SIZE,
    height: VINYL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylBehind: {
    position: 'absolute',
    opacity: 0.3,
    transform: [{ scale: 0.95 }, { translateY: 20 }],
    zIndex: 0,
  },
  vinylTouchable: {
    width: '100%',
    height: '100%',
  },
  vinylRecord: {
    width: VINYL_SIZE,
    height: VINYL_SIZE,
    borderRadius: VINYL_SIZE / 2,
    backgroundColor: '#111',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  vinylFront: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vinylBack: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vinylImage: {
    width: VINYL_SIZE,
    height: VINYL_SIZE,
    borderRadius: VINYL_SIZE / 2,
  },
  vinylCenterHole: {
    position: 'absolute',
    width: VINYL_CENTER_HOLE,
    height: VINYL_CENTER_HOLE,
    borderRadius: VINYL_CENTER_HOLE / 2,
    backgroundColor: '#000',
    zIndex: 10,
    borderWidth: 2,
    borderColor: '#333',
  },
  vinylGrooves: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  groove: {
    position: 'absolute',
    borderRadius: 1000,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  vinylBackContent: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  backTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 8,
  },
  backArtist: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  playButton: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  playText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },

  cardFooter: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: VINYL_SIZE,
    paddingHorizontal: 20,
  },
  footerUsername: {
    color: '#1DB954',
    fontWeight: 'bold',
    fontSize: 14,
  },
  footerTime: {
    color: '#666',
    fontSize: 12,
  },

  swipeHints: {
    marginTop: 12,
    alignItems: 'center',
  },
  swipeHint: {
    marginVertical: 4,
  },
  swipeHintText: {
    color: '#444',
    fontSize: 11,
    fontWeight: '500',
  },

  progressContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  progressText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '500',
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

  miniPlayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 72,
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderColor: '#333',
  },
  miniArt: { width: 48, height: 48, borderRadius: 8 },
  miniTitle: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  miniArtist: { color: '#aaa', fontSize: 12 },
  miniPlay: { color: '#1DB954', fontWeight: 'bold', fontSize: 16 },
  miniClose: { color: '#fff', fontSize: 24 },
});
