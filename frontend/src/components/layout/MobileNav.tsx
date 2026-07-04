import { NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useNavItems, type NavItem } from '@/hooks/useNavItems';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

export function MobileNav() {
  const location = useLocation();
  const { mobileNavOpen, setMobileNavOpen } = useUIStore();
  const { mobileBar } = useNavItems();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-background pb-safe">
      {mobileBar.map((item) => {
        const Icon = item.icon;
        const isActive =
          location.pathname === item.href ||
          location.pathname.startsWith(`${item.href}/`);

        return (
          <NavLink
            key={item.href}
            to={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs',
              isActive
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{item.mobileLabel ?? item.label}</span>
          </NavLink>
        );
      })}

      {/* More menu trigger */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetTrigger asChild>
          <button
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs',
              'text-muted-foreground hover:text-foreground'
            )}
          >
            <Menu className="h-5 w-5" />
            <span>More</span>
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <MobileNavSheet />
        </SheetContent>
      </Sheet>
    </nav>
  );
}

/**
 * Lightweight nav list for the mobile "More" sheet. Uses the same shared nav
 * source (feature flags + permissions) as the desktop sidebar, without the
 * desktop-only chrome (fixed positioning, collapse toggle, tooltips).
 */
function MobileNavSheet() {
  const location = useLocation();
  const { setMobileNavOpen } = useUIStore();
  const { main, media, bottom } = useNavItems();

  const renderGroup = (items: NavItem[]) => (
    <nav className="space-y-1 px-2">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive =
          location.pathname === item.href ||
          location.pathname.startsWith(`${item.href}/`);

        return (
          <NavLink
            key={item.href}
            to={item.href}
            onClick={() => setMobileNavOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center border-b px-4">
        <span className="text-xl font-bold">Basis</span>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        {renderGroup(main)}
        <Separator className="my-4" />
        {renderGroup(media)}
      </ScrollArea>

      {/* Bottom navigation */}
      <div className="border-t py-4">{renderGroup(bottom)}</div>
    </div>
  );
}
