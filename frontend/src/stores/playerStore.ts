import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { musicApi, type Track } from '@/api/media';

interface PlayerState {
  // Current track and queue
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;

  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;

  // Queue settings
  shuffled: boolean;
  repeatMode: 'off' | 'all' | 'one';

  // UI state
  isExpanded: boolean;
  isQueueVisible: boolean;

  // Audio element reference (set by MusicPlayer component)
  audioRef: HTMLAudioElement | null;

  // Actions
  setAudioRef: (ref: HTMLAudioElement | null) => void;
  playTrack: (track: Track, queue?: Track[]) => void;
  playPause: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  addToQueue: (tracks: Track[]) => void;
  clearQueue: () => void;
  removeFromQueue: (index: number) => void;
  playFromQueue: (index: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsExpanded: (expanded: boolean) => void;
  setIsQueueVisible: (visible: boolean) => void;
  onTrackEnded: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentTrack: null,
      queue: [],
      queueIndex: 0,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 1,
      isMuted: false,
      shuffled: false,
      repeatMode: 'off',
      isExpanded: false,
      isQueueVisible: false,
      audioRef: null,

      setAudioRef: (ref) => set({ audioRef: ref }),

      playTrack: (track, queue) => {
        const state = get();
        const newQueue = queue || [track];
        const newIndex = newQueue.findIndex((t) => t.id === track.id);

        set({
          currentTrack: track,
          queue: newQueue,
          queueIndex: newIndex >= 0 ? newIndex : 0,
          isPlaying: true,
          currentTime: 0,
        });

        // Update audio source
        if (state.audioRef) {
          state.audioRef.src = musicApi.getStreamUrl(track.id);
          state.audioRef.play().catch(console.error);
        }

        // Record listen after 30 seconds
        setTimeout(() => {
          musicApi.recordListen(track.id, 30).catch(console.error);
        }, 30000);
      },

      playPause: () => {
        const state = get();
        if (state.isPlaying) {
          state.audioRef?.pause();
          set({ isPlaying: false });
        } else {
          state.audioRef?.play().catch(console.error);
          set({ isPlaying: true });
        }
      },

      play: () => {
        const state = get();
        state.audioRef?.play().catch(console.error);
        set({ isPlaying: true });
      },

      pause: () => {
        const state = get();
        state.audioRef?.pause();
        set({ isPlaying: false });
      },

      next: () => {
        const state = get();
        const { queue, queueIndex, repeatMode, shuffled } = state;

        if (queue.length === 0) return;

        let nextIndex: number;

        if (shuffled) {
          // Random next track
          nextIndex = Math.floor(Math.random() * queue.length);
        } else if (queueIndex < queue.length - 1) {
          nextIndex = queueIndex + 1;
        } else if (repeatMode === 'all') {
          nextIndex = 0;
        } else {
          // At end of queue, stop playing
          set({ isPlaying: false });
          return;
        }

        const nextTrack = queue[nextIndex];
        set({
          currentTrack: nextTrack,
          queueIndex: nextIndex,
          currentTime: 0,
        });

        if (state.audioRef) {
          state.audioRef.src = musicApi.getStreamUrl(nextTrack.id);
          state.audioRef.play().catch(console.error);
        }
      },

      previous: () => {
        const state = get();
        const { queue, queueIndex, currentTime } = state;

        if (queue.length === 0) return;

        // If more than 3 seconds into track, restart it
        if (currentTime > 3) {
          if (state.audioRef) {
            state.audioRef.currentTime = 0;
          }
          set({ currentTime: 0 });
          return;
        }

        const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
        const prevTrack = queue[prevIndex];

        set({
          currentTrack: prevTrack,
          queueIndex: prevIndex,
          currentTime: 0,
        });

        if (state.audioRef) {
          state.audioRef.src = musicApi.getStreamUrl(prevTrack.id);
          state.audioRef.play().catch(console.error);
        }
      },

      seek: (time) => {
        const state = get();
        if (state.audioRef) {
          state.audioRef.currentTime = time;
        }
        set({ currentTime: time });
      },

      setVolume: (volume) => {
        const state = get();
        if (state.audioRef) {
          state.audioRef.volume = volume;
        }
        set({ volume, isMuted: volume === 0 });
      },

      toggleMute: () => {
        const state = get();
        const newMuted = !state.isMuted;
        if (state.audioRef) {
          state.audioRef.muted = newMuted;
        }
        set({ isMuted: newMuted });
      },

      toggleShuffle: () => {
        set((state) => ({ shuffled: !state.shuffled }));
      },

      toggleRepeat: () => {
        set((state) => {
          const modes: ('off' | 'all' | 'one')[] = ['off', 'all', 'one'];
          const currentIndex = modes.indexOf(state.repeatMode);
          const nextIndex = (currentIndex + 1) % modes.length;
          return { repeatMode: modes[nextIndex] };
        });
      },

      addToQueue: (tracks) => {
        set((state) => ({
          queue: [...state.queue, ...tracks],
        }));
      },

      clearQueue: () => {
        set({
          queue: [],
          queueIndex: 0,
          currentTrack: null,
          isPlaying: false,
        });
      },

      removeFromQueue: (index) => {
        set((state) => {
          const newQueue = [...state.queue];
          newQueue.splice(index, 1);

          let newIndex = state.queueIndex;
          if (index < state.queueIndex) {
            newIndex--;
          } else if (index === state.queueIndex && index >= newQueue.length) {
            newIndex = Math.max(0, newQueue.length - 1);
          }

          return {
            queue: newQueue,
            queueIndex: newIndex,
            currentTrack: newQueue[newIndex] || null,
          };
        });
      },

      playFromQueue: (index) => {
        const state = get();
        const track = state.queue[index];
        if (!track) return;

        set({
          currentTrack: track,
          queueIndex: index,
          currentTime: 0,
        });

        if (state.audioRef) {
          state.audioRef.src = musicApi.getStreamUrl(track.id);
          state.audioRef.play().catch(console.error);
        }

        set({ isPlaying: true });
      },

      setCurrentTime: (time) => set({ currentTime: time }),
      setDuration: (duration) => set({ duration }),
      setIsExpanded: (expanded) => set({ isExpanded: expanded }),
      setIsQueueVisible: (visible) => set({ isQueueVisible: visible }),

      onTrackEnded: () => {
        const state = get();
        if (state.repeatMode === 'one') {
          // Repeat current track
          if (state.audioRef) {
            state.audioRef.currentTime = 0;
            state.audioRef.play().catch(console.error);
          }
        } else {
          state.next();
        }
      },
    }),
    {
      name: 'music-player',
      partialize: (state) => ({
        volume: state.volume,
        isMuted: state.isMuted,
        shuffled: state.shuffled,
        repeatMode: state.repeatMode,
      }),
    }
  )
);

// Helper function for formatting duration
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
