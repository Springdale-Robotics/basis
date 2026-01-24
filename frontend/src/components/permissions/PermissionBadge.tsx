import { useQuery } from '@tanstack/react-query';
import { Eye, Edit, Shield, Crown, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { permissionsApi, type ResourceType, type PermissionLevel } from '@/api/permissions';

interface PermissionBadgeProps {
  resourceType: ResourceType;
  resourceId: string;
  showLabel?: boolean;
}

export function PermissionBadge({
  resourceType,
  resourceId,
  showLabel = true,
}: PermissionBadgeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['my-access', resourceType, resourceId],
    queryFn: () => permissionsApi.getMyAccess(resourceType, resourceId),
  });

  if (isLoading || !data) {
    return null;
  }

  const { accessLevel, isOwner, canEdit, canAdmin } = data;

  if (!accessLevel) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-muted-foreground">
              <Lock className="h-3 w-3" />
              {showLabel && <span className="ml-1">No access</span>}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <span>You don't have access to this {resourceType}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (isOwner) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="default" className="bg-amber-500 hover:bg-amber-600">
              <Crown className="h-3 w-3" />
              {showLabel && <span className="ml-1">Owner</span>}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <span>You are the owner of this {resourceType}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (canAdmin) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="default">
              <Shield className="h-3 w-3" />
              {showLabel && <span className="ml-1">Admin</span>}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <span>You have admin access to this {resourceType}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (canEdit) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary">
              <Edit className="h-3 w-3" />
              {showLabel && <span className="ml-1">Can edit</span>}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <span>You can edit this {resourceType}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline">
            <Eye className="h-3 w-3" />
            {showLabel && <span className="ml-1">View only</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <span>You can only view this {resourceType}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Simplified version that takes access level directly instead of fetching
interface StaticPermissionBadgeProps {
  accessLevel: PermissionLevel | null;
  isOwner?: boolean;
  showLabel?: boolean;
}

export function StaticPermissionBadge({
  accessLevel,
  isOwner = false,
  showLabel = true,
}: StaticPermissionBadgeProps) {
  if (!accessLevel) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Lock className="h-3 w-3" />
        {showLabel && <span className="ml-1">No access</span>}
      </Badge>
    );
  }

  if (isOwner) {
    return (
      <Badge variant="default" className="bg-amber-500 hover:bg-amber-600">
        <Crown className="h-3 w-3" />
        {showLabel && <span className="ml-1">Owner</span>}
      </Badge>
    );
  }

  switch (accessLevel) {
    case 'admin':
      return (
        <Badge variant="default">
          <Shield className="h-3 w-3" />
          {showLabel && <span className="ml-1">Admin</span>}
        </Badge>
      );
    case 'edit':
      return (
        <Badge variant="secondary">
          <Edit className="h-3 w-3" />
          {showLabel && <span className="ml-1">Can edit</span>}
        </Badge>
      );
    case 'view':
    case 'view_busy':
    default:
      return (
        <Badge variant="outline">
          <Eye className="h-3 w-3" />
          {showLabel && <span className="ml-1">View only</span>}
        </Badge>
      );
  }
}
