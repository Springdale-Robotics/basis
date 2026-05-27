import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Users, User as UserIcon } from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
}

export function AssigneePicker({
  users,
  groups,
  value,
  onChange,
  compact,
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

  const triggerLabel = selectedUser
    ? selectedUser.displayName
    : selectedGroup
    ? selectedGroup.name
    : 'Unassigned';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'sm' : 'default'}
          role="combobox"
          aria-expanded={open}
          className={cn(
            'justify-between',
            compact && 'h-7 px-2 text-xs font-normal',
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
              <Users className="h-4 w-4 text-muted-foreground" />
            ) : (
              <UserIcon className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
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
            {groups.length > 0 && (
              <CommandGroup heading="Groups">
                {groups.map((g) => (
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
                ))}
              </CommandGroup>
            )}
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
