// app/ProfileScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.42;
const API_URL = 'https://earshot-app.onrender.com';

interface Post {
  id: number;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  is_first_discover: boolean;
}

interface ProfileUser {
  id: number;
  username: string;
  twitter: string;
  followers: number;
  following: number;
  is_following: boolean;
  is_own_profile: boolean;
}

export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [isEditingTwitter, setIsEditingTwitter] = useState(false);
  const [twitterInput, setTwitterInput] = useState('');
  const [savingTwitter, setSavingTwitter] = useState(false);

  // Load token from storage
  useEffect(() => {
    const loadToken = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('auth_token');
        if (storedToken) {
          setToken(storedToken);
        }
      } catch (e) {
        console.warn('Failed to load token:', e);
      }
    };
    loadToken();
  }, []);

  // Load profile data
  useEffect(() => {
    if (username) {
      loadProfile();
    }
  }, [username, token]);

  const loadProfile = async () => {
    if (!username) return;
    setLoading(true);
    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_URL}/api/profile/${username}`, {
        headers,
      });

      if (res.status === 404) {
        Alert.alert('Not Found', 'User not found');
        router.back();
        return;
      }

      const data = await res.json();
      setProfile(data.user);
      setPosts(data.posts);
      setFollowing(data.user.is_following);
      setTwitterInput(data.user.twitter || '');
    } catch (e) {
      Alert.alert('Error', 'Failed to load profile');
      console.warn(e);
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async () => {
    if (!token || !profile) {
      Alert.alert('Login Required', 'Please log in to follow users');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await fetch(`${API_URL}/api/follow/${profile.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (res.ok) {
        setFollowing(data.is_following);
        setProfile(prev => prev ? { ...prev, followers: data.followers } : null);
      } else {
        Alert.alert('Error', data.error || 'Failed to follow');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error');
    }
  };

  const handleSaveTwitter = async () => {
    if (!token) {
      Alert.alert('Login Required', 'Please log in to update your profile');
      return;
    }

    setSavingTwitter(true);
    try {
      const res = await fetch(`${API_URL}/api/profile/twitter`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ twitter: twitterInput }),
      });

      const data = await res.json();
      if (res.ok) {
        setProfile(prev => prev ? { ...prev, twitter: data.twitter } : null);
        setIsEditingTwitter(false);
        Alert.alert('Success', 'Twitter handle updated');
      } else {
        Alert.alert('Error', data.error || 'Failed to update');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error');
    } finally {
      setSavingTwitter(false);
    }
  };

  const openTwitter = (handle: string) => {
    if (!handle) return;
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
    Linking.openURL(`https://twitter.com/${cleanHandle}`);
  };

  const playSong = async (post: Post) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let target = post.url;
    if (target.startsWith('spotify:')) {
      target = target.replace('spotify:', 'https://open.spotify.com/');
    }
    try {
      await Linking.openURL(target);
    } catch (e) {
      console.warn(e);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1DB954" />
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>User not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={posts}
        keyExtractor={item => item.id.toString()}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.username}>@{profile.username}</Text>

            {/* Stats */}
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{profile.followers}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{profile.following}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{posts.length}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </View>
            </View>

            {/* Twitter Section */}
            {profile.is_own_profile ? (
              <View style={styles.twitterSection}>
                {isEditingTwitter ? (
                  <View style={styles.twitterEdit}>
                    <TextInput
                      style={styles.twitterInput}
                      value={twitterInput}
                      onChangeText={setTwitterInput}
                      placeholder="Twitter handle (without @)"
                      placeholderTextColor="#666"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={styles.saveButton}
                      onPress={handleSaveTwitter}
                      disabled={savingTwitter}
                    >
                      {savingTwitter ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.saveButtonText}>Save</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => {
                        setIsEditingTwitter(false);
                        setTwitterInput(profile.twitter || '');
                      }}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.twitterDisplay}>
                    {profile.twitter ? (
                      <TouchableOpacity
                        style={styles.twitterLink}
                        onPress={() => openTwitter(profile.twitter)}
                      >
                        <Text style={styles.twitterText}>@{profile.twitter}</Text>
                        <Text style={styles.twitterLinkText}>Open on X</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.noTwitter}>No X account linked</Text>
                    )}
                    <TouchableOpacity
                      style={styles.editTwitterButton}
                      onPress={() => setIsEditingTwitter(true)}
                    >
                      <Text style={styles.editTwitterButtonText}>
                        {profile.twitter ? 'Edit' : 'Link X Account'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              profile.twitter && (
                <TouchableOpacity
                  style={styles.twitterLink}
                  onPress={() => openTwitter(profile.twitter)}
                >
                  <Text style={styles.twitterText}>@{profile.twitter}</Text>
                  <Text style={styles.twitterLinkText}>Open on X</Text>
                </TouchableOpacity>
              )
            )}

            {/* Follow Button */}
            {!profile.is_own_profile && (
              <TouchableOpacity
                style={[styles.followButton, following && styles.followingButton]}
                onPress={handleFollow}
              >
                <Text style={[styles.followButtonText, following && styles.followingButtonText]}>
                  {following ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        }
        contentContainerStyle={styles.listContent}
        numColumns={2}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.postCard}
            onPress={() => playSong(item)}
            activeOpacity={0.9}
          >
            <Image source={{ uri: item.thumbnail }} style={styles.postThumbnail} />
            {item.is_first_discover && (
              <View style={styles.firstDiscoverBadge}>
                <Text style={styles.firstDiscoverText}>✨ First</Text>
              </View>
            )}
            <View style={styles.postInfo}>
              <Text style={styles.postTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.postArtist} numberOfLines={1}>
                {item.artist}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No posts yet</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#fff',
    fontSize: 16,
  },
  header: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    marginBottom: 20,
  },
  username: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1DB954',
    marginBottom: 20,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 20,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  twitterSection: {
    width: '100%',
    marginBottom: 20,
  },
  twitterDisplay: {
    alignItems: 'center',
  },
  twitterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  twitterText: {
    color: '#1DA1F2',
    fontSize: 16,
    marginRight: 8,
  },
  twitterLinkText: {
    color: '#888',
    fontSize: 12,
  },
  noTwitter: {
    color: '#666',
    fontSize: 14,
    marginBottom: 12,
  },
  editTwitterButton: {
    backgroundColor: '#1DA1F2',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  editTwitterButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  twitterEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  twitterInput: {
    backgroundColor: '#222',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginRight: 8,
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: '#1DB954',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginRight: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: '#333',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  followButton: {
    backgroundColor: '#1DB954',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 24,
    marginTop: 10,
  },
  followingButton: {
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#555',
  },
  followButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  followingButtonText: {
    color: '#aaa',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  row: {
    justifyContent: 'space-between',
  },
  postCard: {
    width: CARD_WIDTH,
    marginBottom: 16,
    backgroundColor: '#111',
    borderRadius: 12,
    overflow: 'hidden',
  },
  postThumbnail: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    backgroundColor: '#222',
  },
  firstDiscoverBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(29, 185, 84, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  firstDiscoverText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
  },
  postInfo: {
    padding: 12,
  },
  postTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  postArtist: {
    color: '#aaa',
    fontSize: 12,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
});
