// app/(tabs)/ProfileScreen.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.username}>@{username}</Text>
        <Text style={styles.bio}>No bio yet.</Text>
      </View>
      <Text style={styles.posts}>Posts coming soon…</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { padding: 20, alignItems: 'center' },
  username: { fontSize: 32, fontWeight: 'bold', color: '#1DB954' },
  bio: { fontSize: 16, color: '#aaa', marginTop: 8 },
  posts: { color: '#fff', textAlign: 'center', marginTop: 40 },
});