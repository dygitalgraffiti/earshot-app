// utils/urlParser.ts
// Utility to parse and normalize music URLs from various platforms

export interface ParsedMusicUrl {
  platform: 'spotify' | 'apple' | 'youtube' | 'unknown';
  url: string;
  isValid: boolean;
}

/**
 * Parses a URL and determines if it's a valid music platform URL
 */
export function parseMusicUrl(url: string): ParsedMusicUrl {
  if (!url || typeof url !== 'string') {
    return { platform: 'unknown', url: '', isValid: false };
  }

  const trimmedUrl = url.trim();

  // Spotify URLs
  if (
    trimmedUrl.includes('spotify.com') ||
    trimmedUrl.includes('open.spotify.com') ||
    trimmedUrl.startsWith('spotify:')
  ) {
    // Normalize Spotify URLs
    let normalizedUrl = trimmedUrl;
    if (normalizedUrl.startsWith('spotify:')) {
      normalizedUrl = normalizedUrl.replace('spotify:', 'https://open.spotify.com/');
    }
    return { platform: 'spotify', url: normalizedUrl, isValid: true };
  }

  // Apple Music URLs
  if (
    trimmedUrl.includes('music.apple.com') ||
    trimmedUrl.includes('itunes.apple.com') ||
    trimmedUrl.startsWith('music://') ||
    trimmedUrl.startsWith('itms://') ||
    trimmedUrl.startsWith('itmss://')
  ) {
    // Normalize Apple Music URLs
    let normalizedUrl = trimmedUrl;
    if (normalizedUrl.startsWith('music://')) {
      normalizedUrl = normalizedUrl.replace('music://', 'https://music.apple.com/');
    } else if (normalizedUrl.startsWith('itms://') || normalizedUrl.startsWith('itmss://')) {
      normalizedUrl = normalizedUrl.replace(/^itms?s?:\/\//, 'https://');
    }
    return { platform: 'apple', url: normalizedUrl, isValid: true };
  }

  // YouTube/YouTube Music URLs
  if (
    trimmedUrl.includes('youtube.com') ||
    trimmedUrl.includes('youtu.be') ||
    trimmedUrl.includes('music.youtube.com') ||
    trimmedUrl.startsWith('youtube://') ||
    trimmedUrl.startsWith('vnd.youtube://')
  ) {
    // Normalize YouTube URLs
    let normalizedUrl = trimmedUrl;
    if (normalizedUrl.startsWith('youtube://') || normalizedUrl.startsWith('vnd.youtube://')) {
      normalizedUrl = normalizedUrl.replace(/^(vnd\.)?youtube:\/\//, 'https://www.youtube.com/');
    }
    // Convert youtu.be to youtube.com
    if (normalizedUrl.includes('youtu.be/')) {
      normalizedUrl = normalizedUrl.replace('youtu.be/', 'youtube.com/watch?v=');
    }
    return { platform: 'youtube', url: normalizedUrl, isValid: true };
  }

  return { platform: 'unknown', url: trimmedUrl, isValid: false };
}

/**
 * Extracts URL from shared text (handles cases where URL is embedded in text)
 */
export function extractUrlFromText(text: string): string | null {
  if (!text) return null;

  // Try to find URLs in the text
  const urlRegex = /(https?:\/\/[^\s]+|spotify:[^\s]+|music:\/\/[^\s]+|youtube:\/\/[^\s]+)/gi;
  const matches = text.match(urlRegex);

  if (matches && matches.length > 0) {
    return matches[0];
  }

  // If no URL found, return the text as-is (might be a URL without protocol)
  return text.trim();
}

