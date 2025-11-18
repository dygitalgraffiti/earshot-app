// app/ProfileScreen.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const API_URL = 'https://earshot-app.onrender.com';

interface ProfilePost {
  id: number;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  createdAt: string;
  is_first_discover: boolean;
}

interface ProfileData {
  user: {
    id: number;
    username: string;
    twitter: string;
    followers: number;
    following: number;
  };
  is_own_profile: boolean;
  is_following: boolean;
  posts: ProfilePost[];
}

export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editedUsername, setEditedUsername] = useState('');
  const [updatingUsername, setUpdatingUsername] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const savedToken = await AsyncStorage.getItem('authToken');
        setToken(savedToken);
        
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        if (savedToken) {
          headers['Authorization'] = `Bearer ${savedToken}`;
        }

        const res = await fetch(`${API_URL}/api/profile/${username}`, { headers });
        if (!res.ok) {
          Alert.alert('Error', 'Failed to load profile');
          return;
        }

        const data = await res.json();
        setProfile({
          ...data,
          is_following: Boolean(data.is_following),
        });
        setEditedUsername(data.user.username);
      } catch (e) {
        console.error('Profile error:', e);
        Alert.alert('Error', 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [username]);

  const deletePost = async (postId: number) => {
    if (!token) {
      Alert.alert('Error', 'You must be logged in to delete posts');
      return;
    }

    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(postId);
              const res = await fetch(`${API_URL}/api/post/${postId}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });

              if (!res.ok) {
                const error = await res.json();
                Alert.alert('Error', error.error || 'Failed to delete post');
                return;
              }

              // Remove post from local state
              if (profile) {
                setProfile({
                  ...profile,
                  posts: profile.posts.filter(p => p.id !== postId),
                });
              }
            } catch (e) {
              Alert.alert('Error', 'Failed to delete post');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const openSong = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Error', 'Unable to open link');
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return 'Just now';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Just now';

    const now = Date.now();
    const diff = Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1DB954" />
        </View>
      </SafeAreaView>
    );
  }

  const toggleFollow = async () => {
    if (!token || !profile) {
      Alert.alert('Error', 'You must be logged in to follow users');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/follow/${profile.user.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = 'Failed to update follow status';
        try {
          const parsed = JSON.parse(errorText);
          errorMsg = parsed.error || errorMsg;
        } catch {
          if (res.status === 401) {
            errorMsg = 'Session expired. Please log in again.';
          } else if (errorText) {
            errorMsg = errorText;
          }
        }
        Alert.alert('Error', errorMsg);
        if (res.status === 401) {
          await AsyncStorage.removeItem('authToken');
          setToken(null);
          router.push('/');
        }
        return;
      }

      const data = await res.json();
      setProfile({
        ...profile,
        is_following: data.action === 'followed',
        user: {
          ...profile.user,
          followers: data.followers,
        },
      });
    } catch (e) {
      Alert.alert('Error', 'Failed to update follow status');
    }
  };

  const updateUsername = async () => {
    if (!token) {
      Alert.alert('Error', 'You must be logged in to update your username');
      return;
    }

    if (!profile) {
      Alert.alert('Error', 'Profile not loaded');
      return;
    }

    const trimmedUsername = editedUsername.trim().toLowerCase();
    if (!trimmedUsername) {
      Alert.alert('Error', 'Username cannot be empty');
      return;
    }

    if (trimmedUsername === profile.user.username) {
      setIsEditingUsername(false);
      return;
    }

    setUpdatingUsername(true);
    try {
      const res = await fetch(`${API_URL}/api/profile/username`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: trimmedUsername }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        Alert.alert('Error', errorData.error || 'Failed to update username');
        if (profile) {
          setEditedUsername(profile.user.username); // Reset to original
        }
        setUpdatingUsername(false);
        return;
      }

      const data = await res.json();
      if (profile) {
        setProfile({
          ...profile,
          user: {
            ...profile.user,
            username: data.username,
          },
        });
      }
      setEditedUsername(data.username);
      setIsEditingUsername(false);
      
      // Update stored username
      await AsyncStorage.setItem('currentUsername', data.username);
      
      Alert.alert('Success', 'Username updated!');
    } catch (e) {
      Alert.alert('Error', 'Failed to update username');
      if (profile) {
        setEditedUsername(profile.user.username); // Reset to original
      }
    } finally {
      setUpdatingUsername(false);
    }
  };

  if (!profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorText}>Profile not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.usernameRow}>
          {isEditingUsername ? (
            <View style={styles.usernameEditContainer}>
              <TextInput
                style={styles.usernameInput}
                value={editedUsername}
                onChangeText={setEditedUsername}
                autoFocus
                placeholder="Username"
                placeholderTextColor="#666"
              />
              <TouchableOpacity
                style={styles.saveButton}
                onPress={updateUsername}
                disabled={updatingUsername}
              >
                {updatingUsername ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setIsEditingUsername(false);
                  setEditedUsername(profile.user.username);
                }}
                disabled={updatingUsername}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.username}>@{profile.user.username}</Text>
              {profile.is_own_profile && (
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => setIsEditingUsername(true)}
                >
                  <Text style={styles.editButtonText}>✏️</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
        {profile.user.twitter && (
          <Text style={styles.twitter}>@{profile.user.twitter}</Text>
        )}
        {!profile.is_own_profile && (
          <TouchableOpacity
            style={[
              styles.followButton,
              profile.is_following ? styles.followingButton : null,
            ]}
            onPress={toggleFollow}
          >
            <Text style={[
              styles.followButtonText,
              profile.is_following ? styles.followingButtonText : null,
            ]}>
              {profile.is_following ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{profile.user.followers}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{profile.user.following}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={profile.posts}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.postItem}
            activeOpacity={0.8}
            onPress={() => openSong(item.url)}
          >
            <Image source={{ uri: item.thumbnail }} style={styles.thumbnail} />
            <View style={styles.postInfo}>
              <Text style={styles.postTitle} numberOfLines={1}>
                {item.title}
              </Text>
              {item.artist && item.artist.trim().toLowerCase() !== 'unknown artist' && (
                <Text style={styles.postArtist} numberOfLines={1}>
                  {item.artist}
                </Text>
              )}
              <Text style={styles.postDate}>
                {formatDate(
                  item.createdAt ||
                  // fallback field names just in case
                  (item as any).created_at ||
                  (item as any).created_at
                )}
              </Text>
            </View>
            {profile.is_own_profile && (
              <TouchableOpacity
                style={styles.menuButton}
                onPress={() => deletePost(item.id)}
                disabled={deletingId === item.id}
              >
                {deletingId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.menuDots}>⋯</Text>
                )}
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  username: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1DB954',
  },
  editButton: {
    marginLeft: 12,
    padding: 4,
  },
  editButtonText: {
    fontSize: 20,
  },
  usernameEditContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  usernameInput: {
    backgroundColor: '#222',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 20,
    fontWeight: 'bold',
    minWidth: 150,
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cancelButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  twitter: {
    fontSize: 16,
    color: '#888',
    marginBottom: 16,
  },
  stats: {
    flexDirection: 'row',
    gap: 30,
    marginTop: 16,
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  postItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  postInfo: {
    flex: 1,
  },
  postTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  postArtist: {
    fontSize: 14,
    color: '#888',
  },
  postDate: {
    fontSize: 12,
    color: '#bbb',
    marginTop: 4,
  },
  followButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#1DB954',
    marginTop: 12,
  },
  followButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
    textTransform: 'uppercase',
  },
  followingButton: {
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#444',
  },
  followingButtonText: {
    color: '#fff',
  },
  menuButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuDots: {
    fontSize: 24,
    color: '#888',
    lineHeight: 24,
  },
  empty: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
  errorText: {
    color: '#666',
    fontSize: 16,
  },
});
