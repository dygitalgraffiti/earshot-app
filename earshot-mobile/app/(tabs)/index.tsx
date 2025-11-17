import React, { useState, useEffect } from 'react';
import {
  Text,
  View,
  TextInput,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Dimensions,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { MotiView, AnimatePresence } from 'moti';

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
}

export default function HomeScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [feed, setFeed] = useState<Post[]>([]);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [openingId, setOpeningId] = useState<number | null>(null);

  /* AUTH */
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

  /* PLAY – App or Browser */
  const playSong = async (post: Post) => {
    if (openingId === post.id) return;
    setOpeningId(post.id);

    let target = post.url;
    if (target.startsWith('spotify:')) {
      target = target.replace('spotify:', 'https://open.spotify.com/');
    }

    try {
      const canOpen = await Linking.canOpenURL(target);
      await Linking.openURL(target);
    } catch {
      await Linking.openURL(target);
    } finally {
      setOpeningId(null);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loginBox}>
          <Text style={styles.logo}>Earshot</Text>
          <Text style={styles.slogan}>Share music. Follow friends.</Text>
          <TextInput placeholder="Username" value={username} onChangeText={setUsername} style={styles.input} autoCapitalize="none" />
          <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
          <TouchableOpacity style={styles.button} onPress={login}>
            <Text style={styles.buttonText}>LOGIN</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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
        data={feed}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.feed}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={styles.card}>
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
                      {/* CROPPED ALBUM ART – NO BLACK BARS */}
                      <View style={styles.albumArtContainer}>
                        <Image
                          source={{ uri: item.thumbnail }}
                          style={styles.albumArtCropped}
                          resizeMode="cover"
                        />
                      </View>
                      <Text style={styles.frontUsername}>@{item.username}</Text>
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
          </View>
        )}
      />
    </SafeAreaView>
  );
}

/* STYLES – CROPPED ART + NO BLACK BARS */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loginBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logo: {
    fontSize: 48,
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
  header: {
    padding: 20,
    alignItems: 'center',
  },
  postBox: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  postBtn: {
    backgroundColor: '#1DB954',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  postBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  feed: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  card: {
    marginBottom: 32,
    alignItems: 'center',
  },
  flipWrapper: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
  },
  cardFront: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // NEW: Crop container
  albumArtContainer: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    overflow: 'hidden',
    borderRadius: 20,
  },
  // NEW: Crop 16:9 → 1:1 center
 albumArtCropped: {
  width: CARD_WIDTH * 1.78,
  height: CARD_WIDTH * 1.78,
  position: 'absolute',
  left: -CARD_WIDTH * 0.39,
  top: -CARD_WIDTH * 0.39,
},
  frontUsername: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    color: '#1DB954',
    fontSize: 14,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardBack: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
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
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  playButton: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 30,
  },
  playText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});