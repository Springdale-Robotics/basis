import { useDevice } from '@/hooks/useDevice';
import { usePlayerStore } from '@/stores/playerStore';

/** Height of the fixed mobile bottom nav (MobileNav, h-16). */
export const MOBILE_NAV_HEIGHT = 64;
/** Height of the collapsed music player bar (MusicPlayer, h-20). */
export const MUSIC_PLAYER_HEIGHT = 80;

export interface BottomStack {
  /** Height in px occupied by the mobile bottom nav (0 on desktop). */
  navHeight: number;
  /** Height in px occupied by the collapsed music player (0 when no track). */
  playerHeight: number;
  /** Total height of fixed bars docked to the bottom of the viewport. */
  stackHeight: number;
}

/**
 * Reports how much of the bottom of the viewport is occupied by fixed bars
 * (mobile bottom nav + music player) so other bottom-anchored elements —
 * the offline pill, the bug-report FAB, page content padding — can stack
 * above them instead of overlapping.
 */
export function useBottomStack(): BottomStack {
  const { isMobile } = useDevice();
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const navHeight = isMobile ? MOBILE_NAV_HEIGHT : 0;
  const playerHeight = currentTrack ? MUSIC_PLAYER_HEIGHT : 0;
  return { navHeight, playerHeight, stackHeight: navHeight + playerHeight };
}
