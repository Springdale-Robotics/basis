import { create } from 'zustand';
import { prefersExpandedSidebar } from '@/lib/layout';

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  // Collapsed to the icon rail on anything narrower than a roomy desktop —
  // an expanded 256px sidebar is a big bite out of a tablet viewport. Read
  // once at store creation so a later resize never overrides a manual toggle.
  sidebarCollapsed: !prefersExpandedSidebar(),
  mobileNavOpen: false,
  commandPaletteOpen: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (sidebarOpen) =>
    set({ sidebarOpen }),

  toggleSidebarCollapsed: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (sidebarCollapsed) =>
    set({ sidebarCollapsed }),

  setMobileNavOpen: (mobileNavOpen) =>
    set({ mobileNavOpen }),

  setCommandPaletteOpen: (commandPaletteOpen) =>
    set({ commandPaletteOpen }),
}));
