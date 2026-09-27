import { getShareExtensionKey } from 'expo-share-intent';

/** Share intents arrive as a deep link; send them to the root so the share handler can route to Create Post. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/';
    return path;
  } catch {
    return '/';
  }
}
