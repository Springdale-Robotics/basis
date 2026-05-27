import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Users, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { User } from '@/types/models';
import type { Group } from '@/api/groups';

export interface AssigneeValue {
  userId?: string | null;
  groupId?: string | null;
}

interface AssigneePickerProps {
  users: User[];
  groups: Group[];
  value: AssigneeValue;
  onChange: (value: AssigneeValue) => void;
  /** Compact label (used inside a task row). */
  compact?: boolean;
  /** Override the default 'Unassigned' label on the trigger. */
  placeholder?: string;
}

export function AssigneePicker({
  users,
  groups,
  value,
  onChange,
  compact,
  placeholder = 'Unassigned',
}: AssigneePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedUser = useMemo(
    () => (value.userId ? users.find((u) => u.id === value.userId) : null),
    [users, value.userId],
  );
  const selectedGroup = useMemo(
    () => (value.groupId ? groups.find((g) => g.id === value.groupId) : null),
    [groups, value.groupId],
  );

  const hasSelection = !!(selectedUser || selectedGroup);
  const triggerLabel = selectedUser
    ? selectedUser.displayName
    : selectedGroup
    ? selectedGroup.name
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={compact ? 'sm' : 'default'}
          role="combobox"
          aria-expanded={open}
          aria-label={triggerLabel}
          className={cn(
            'justify-between gap-1.5 font-normal',
            compact && 'h-7 px-2 text-xs',
            !hasSelection && 'text-muted-foreground',
          )}
        >
          <span className="flex items-center gap-2 truncate">
            {selectedUser ? (
              <Avatar className="h-5 w-5">
                <AvatarImage src={selectedUser.avatarUrl} />
                <AvatarFallback className="text-[10px]">
                  {selectedUser.displayName?.[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : selectedGroup ? (
              <Users className="h-3.5 w-3.5" />
            ) : (
              <UserIcon className="h-3.5 w-3.5" />
            )}
            {/* In compact mode, hide the label on narrow viewports so rows
                don't push past the screen edge. */}
            <span
              className={cn(
                'truncate',
                compact && !hasSelection && 'hidden sm:inline',
              )}
            >
              {triggerLabel}
            </span>
          </span>
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Unassigned">
              <CommandItem
                value="__unassigned__"
                onSelect={() => {
                  onChange({ userId: null, groupId: null });
                  setOpen(false);
                }}
              >
                <UserIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                Unassigned
                {!value.userId && !value.groupId && (
                  <Check className="ml-auto h-4 w-4" />
                )}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Groups">
              {groups.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No groups yet.{' '}
                  <Link
                    to="/settings/groups"
                    className="font-medium text-primary hover:underline"
                  >
                    Create one
                  </Link>
                </div>
              ) : (
                groups.map((g) => (
                  <CommandItem
                    key={g.id}
                    value={`group-${g.name}`}
                    onSelect={() => {
                      onChange({ userId: null, groupId: g.id });
                      setOpen(false);
                    }}
                  >
                    <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                    {g.name}
                    {value.groupId === g.id && (
                      <Check className="ml-auto h-4 w-4" />
                    )}
                  </CommandItem>
                ))
              )}
            </CommandGroup>
            {users.length > 0 && (
              <CommandGroup heading="People">
                {users.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`user-${u.displayName}`}
                    onSelect={() => {
                      onChange({ userId: u.id, groupId: null });
                      setOpen(false);
                    }}
                  >
                    <Avatar className="mr-2 h-5 w-5">
                      <AvatarImage src={u.avatarUrl} />
                      <AvatarFallback className="text-[10px]">
                        {u.displayName?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {u.displayName}
                    {value.userId === u.id && (
                      <Check className="ml-auto h-4 w-4" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
