// app/(tabs)/index.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Text,
  View,
  TextInput,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  ActivityIndicator,
  Linking,
  Animated,
} from 'react-native';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.42;

const API_URL = 'https://earshot-app.onrender.com';

interface Post {
  id: number;
  title: string;
  artist: string;
  thumbnail: string;
  username: string;
  url: string;
  createdAt: string; // ISO string from server
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
  const flatListRef = useRef<FlatList>(null);
  const miniPlayerAnim = useRef(new Animated.Value(0)).current;

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
      setFeed(data);
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
      const idx = feed.findIndex(p => p.id === post.id);
      if (idx !== -1) flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      Animated.timing(miniPlayerAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();

      // auto‑hide after 30 s
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

        <FlatList
          ref={flatListRef}
          data={feed}
          keyExtractor={i => i.id.toString()}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.cardContainer}>
              <TouchableOpacity onPress={() => toggleFlip(item.id)} activeOpacity={0.95}>
                <View style={styles.flipWrapper}>
                  <AnimatePresence>
                    {!flipped[item.id] ? (
                      <MotiView
                        key={`front-${item.id}`}
                        from={{ rotateY: '0deg' }}
                        animate={{ rotateY: '0deg' }}
                        exit={{ rotateY: '-90deg' }}
                        transition={{ type: 'timing', duration: 300 }}
                        style={styles.cardFront}
                      >
                        <View style={styles.albumArtContainer}>
                          <Image source={{ uri: item.thumbnail }} style={styles.albumArtCropped} resizeMode="cover" />
                        </View>
                      </MotiView>
                    ) : (
                      <MotiView
                        key={`back-${item.id}`}
                        from={{ rotateY: '90deg' }}
                        animate={{ rotateY: '0deg' }}
                        transition={{ type: 'timing', duration: 300 }}
                        style={styles.cardBack}
                      >
                        <Text style={styles.backTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                        <Text style={styles.backArtist}>{item.artist}</Text>

                        <TouchableOpacity
                          style={styles.playButton}
                          onPress={() => playSong(item)}
                          disabled={openingId === item.id}
                        >
                          {openingId === item.id ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.playText}>Play in App</Text>
                          )}
                        </TouchableOpacity>
                      </MotiView>
                    )}
                  </AnimatePresence>
                </View>
              </TouchableOpacity>

              {/* USER + TIME BELOW */}
              <View style={styles.cardFooter}>
                <TouchableOpacity onPress={() => openProfile(item.username)}>
                  <Text style={styles.footerUsername}>@{item.username}</Text>
                </TouchableOpacity>
                <Text style={styles.footerTime}>{formatDate(item.createdAt)}</Text>
              </View>
            </View>
          )}
        />

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
  feed: { paddingHorizontal: 20, paddingBottom: 100 },

  cardContainer: { marginBottom: 32, alignItems: 'center' },
  flipWrapper: { width: CARD_WIDTH, height: CARD_WIDTH },
  cardFront: { width: CARD_WIDTH, height: CARD_WIDTH, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' },
  albumArtContainer: { width: CARD_WIDTH, height: CARD_WIDTH, overflow: 'hidden', borderRadius: 16 },
  albumArtCropped: { width: CARD_WIDTH * 1.78, height: CARD_WIDTH * 1.78, position: 'absolute', left: -CARD_WIDTH * 0.39, top: -CARD_WIDTH * 0.39 },
  cardBack: { width: CARD_WIDTH, height: CARD_WIDTH, backgroundColor: '#111', borderRadius: 16, padding: 16, justifyContent: 'center', alignItems: 'center' },
  backTitle: { color: '#fff', fontWeight: 'bold', fontSize: 14, textAlign: 'center', marginBottom: 6 },
  backArtist: { color: '#aaa', fontSize: 12, textAlign: 'center', marginBottom: 16 },
  playButton: { backgroundColor: '#1DB954', paddingHorizontal: 24, paddingVertical: 8, borderRadius: 20 },
  playText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  cardFooter: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', width: CARD_WIDTH },
  footerUsername: { color: '#1DB954', fontWeight: 'bold', fontSize: 13 },
  footerTime: { color: '#666', fontSize: 12 },

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