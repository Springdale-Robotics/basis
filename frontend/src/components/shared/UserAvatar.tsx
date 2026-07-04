import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  /** Anything with a display name and optional avatar image. */
  user?: { displayName?: string | null; avatarUrl?: string | null } | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-20 w-20 text-lg',
};

/** Consistent 2-letter initials: first + last word, or first two letters of a single word. */
export function getUserInitials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserAvatar({ user, size = 'md', className }: UserAvatarProps) {
  return (
    <Avatar className={cn(sizeMap[size], className)}>
      <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.displayName ?? undefined} />
      <AvatarFallback className="text-[length:inherit]">
        {getUserInitials(user?.displayName)}
      </AvatarFallback>
    </Avatar>
  );
}
