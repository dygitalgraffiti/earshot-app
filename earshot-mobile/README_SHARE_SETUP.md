# Share Extension Setup Guide

This app now supports one-tap sharing from Spotify, Apple Music, and YouTube Music!

## How It Works

When users share a song from a music app, your app will:
1. Receive the share intent/extension
2. Parse and validate the URL
3. Pre-fill the URL in the post input
4. Optionally auto-post (if user is logged in)

## Setup Instructions

### 1. Install Dependencies

```bash
cd earshot-mobile
npm install
```

### 2. Rebuild Native Code

Since we modified `app.json` with new intent filters and iOS configurations, you need to rebuild:

**For iOS:**
```bash
npx expo prebuild --clean
npx expo run:ios
```

**For Android:**
```bash
npx expo prebuild --clean
npx expo run:android
```

### 3. Testing

**Android:**
1. Open Spotify/Apple Music/YouTube Music
2. Play a song
3. Tap the share button
4. Select "Earshot" from the share sheet
5. The app should open with the URL pre-filled

**iOS:**
1. Open Spotify/Apple Music/YouTube Music
2. Play a song
3. Tap the share button
4. Select "Earshot" from the share sheet
5. The app should open with the URL pre-filled

## Supported Platforms

- ✅ Spotify (spotify.com, open.spotify.com, spotify:)
- ✅ Apple Music (music.apple.com, itunes.apple.com, music://)
- ✅ YouTube Music (youtube.com, youtu.be, music.youtube.com)

## How It Works Technically

1. **Android Share Intent**: Configured in `app.json` with `intentFilters` for `ACTION_SEND`
2. **iOS Share Extension**: Configured via `NSUserActivityTypes` in `app.json`
3. **URL Parsing**: `utils/urlParser.ts` handles normalization and validation
4. **Deep Linking**: `expo-linking` handles incoming URLs
5. **Auto-fill**: URLs are stored in AsyncStorage and picked up by the feed screen

## Troubleshooting

If sharing doesn't work:
1. Make sure you've rebuilt the native code (`npx expo prebuild --clean`)
2. Check that the app appears in the share sheet
3. Verify the URL format is supported
4. Check console logs for parsing errors

