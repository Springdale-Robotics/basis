import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { User } from '@/types/models';

interface UserAvatarProps {
  user: Pick<User, 'displayName' | 'avatarUrl'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

export function UserAvatar({ user, size = 'md', className }: UserAvatarProps) {
  const initials = user.displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Avatar className={cn(sizeMap[size], className)}>
      <AvatarImage src={user.avatarUrl} alt={user.displayName} />
      <AvatarFallback className="text-[length:inherit]">{initials}</AvatarFallback>
    </Avatar>
  );
}
