import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { MotiView, AnimatePresence } from 'moti';
import { Audio } from 'expo-av';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Linking from 'expo-linking';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.85;

const API_URL = 'https://earshot-app.onrender.com';

interface Post {
  id: number;
  title: string;
  artist: string;
  thumbnail: string;
  username: string;
  url: string;
}

/* yt-dlp.js – waits for YTDLP to load */
const YTDLP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://unpkg.com/yt-dlp.js@latest/dist/yt-dlp.min.js"></script>
</head>
<body>
<script>
let ytdlpReady = false;
let pendingUrl = null;

function onYTDLPReady() {
  ytdlpReady = true;
  if (pendingUrl) {
    getAudio(pendingUrl);
    pendingUrl = null;
  }
}

async function getAudio(url) {
  if (!ytdlpReady) {
    pendingUrl = url;
    return;
  }
  try {
    const ytdlp = new YTDLP();
    const info = await ytdlp.getInfo(url);
    const audio = info.formats
      .filter(f => !f.vcodec && f.url)
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
    window.ReactNativeWebView.postMessage(audio.url);
  } catch (e) {
    window.ReactNativeWebView.postMessage("ERROR: " + e.message);
  }
}

const check = setInterval(() => {
  if (typeof YTDLP !== 'undefined') {
    clearInterval(check);
    onYTDLPReady();
  }
}, 50);
</script>
</body>
</html>
`;

export default function HomeScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [feed, setFeed] = useState<Post[]>([]);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    return () => {
      sound?.unloadAsync();
    };
  }, [sound]);

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

  /* -------------------------- PLAY SONG -------------------------- */
  const playSong = async (post: Post) => {
    if (playingId === post.id) {
      await sound?.pauseAsync();
      setPlayingId(null);
      return;
    }

    setLoading(true);
    try {
      if (sound) await sound.unloadAsync();

      const audioUrl = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Taking too long – try again')), 30000);

        (window as any).onWebViewMessage = (event: WebViewMessageEvent) => {
          const data = event.nativeEvent.data;
          clearTimeout(timeout);

          if (data.startsWith('http')) {
            resolve(data);
          } else if (data.startsWith('ERROR:')) {
            reject(new Error(data));
          } else {
            webViewRef.current?.injectJavaScript(`
              getAudio("${data.replace(/"/g, '\\"')}");
              true;
            `);
          }
        };

        webViewRef.current?.postMessage(post.url);
      });

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true }
      );

      setSound(newSound);
      setPlayingId(post.id);

      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
        }
      });
    } catch (err: any) {
      console.error('PLAY ERROR:', err.message);
      Alert.alert('Play Failed', err.message || 'Could not play audio');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loginBox}>
          <Text style={styles.logo}>Earshot</Text>
          <Text style={styles.slogan}>Share music. Follow friends.</Text>
          <TextInput
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            style={styles.input}
            autoCapitalize="none"
          />
          <TextInput
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
          />
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
        <TextInput
          placeholder="Paste YouTube/Spotify link..."
          value={url}
          onChangeText={setUrl}
          style={styles.input}
        />
        <TouchableOpacity style={styles.postBtn} onPress={postTrack}>
          <Text style={styles.postBtnText}>POST</Text>
        </TouchableOpacity>
      </View>

      <WebView
        ref={webViewRef}
        source={{ html: YTDLP_HTML }}
        style={{ height: 0, width: 0, opacity: 0 }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={(event: WebViewMessageEvent) => {
          if ((window as any).onWebViewMessage) {
            (window as any).onWebViewMessage(event);
          }
        }}
      />

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
                      <Image source={{ uri: item.thumbnail }} style={styles.albumArt} />
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
                        disabled={loading}
                      >
                        {loading && playingId === item.id ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ActivityIndicator color="#fff" />
                            <Text style={[styles.playText, { marginLeft: 8 }]}>Loading...</Text>
                          </View>
                        ) : (
                          <Text style={styles.playText}>
                            {playingId === item.id ? 'Pause' : 'Play'}
                          </Text>
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
  albumArt: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    borderRadius: 20,
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