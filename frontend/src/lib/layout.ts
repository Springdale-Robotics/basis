/**
 * Width at or above which app chrome (the nav sidebar, the calendar's own
 * sidebar) starts out expanded. Below it the chrome starts out of the way, so
 * the page content gets the screen.
 *
 * 1280 rather than 1024: an iPad in landscape is 1024 wide, and an expanded
 * 256px nav sidebar there still leaves a cramped grid. Sized so that content
 * only pays for the sidebar on a display with room to spare.
 *
 * This is a first-render default only — once someone toggles a sidebar their
 * choice stands, and no resize takes it back.
 */
export const SIDEBAR_EXPANDED_MIN_WIDTH = 1280;

/** True when the viewport is wide enough to open sidebars by default. */
export function prefersExpandedSidebar(width?: number): boolean {
  const w =
    width ??
    (typeof window === 'undefined' ? SIDEBAR_EXPANDED_MIN_WIDTH : window.innerWidth);
  return w >= SIDEBAR_EXPANDED_MIN_WIDTH;
}
