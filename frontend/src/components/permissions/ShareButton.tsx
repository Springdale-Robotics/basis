import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Share2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ShareDialog } from './ShareDialog';
import { permissionsApi, type ResourceType } from '@/api/permissions';

interface ShareButtonProps {
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  showCount?: boolean;
}

export function ShareButton({
  resourceType,
  resourceId,
  resourceName,
  variant = 'outline',
  size = 'default',
  showCount = true,
}: ShareButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Optionally fetch permission count for tooltip
  const { data: permissionsData } = useQuery({
    queryKey: ['permissions', resourceType, resourceId],
    queryFn: () => permissionsApi.getForResource(resourceType, resourceId),
    enabled: showCount,
  });

  const shareCount = permissionsData?.permissions?.length || 0;

  const buttonContent = (
    <>
      <Share2 className="h-4 w-4" />
      {size !== 'icon' && <span className="ml-2">Share</span>}
      {showCount && shareCount > 0 && size !== 'icon' && (
        <span className="ml-1 text-muted-foreground">({shareCount})</span>
      )}
    </>
  );

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={variant}
              size={size}
              onClick={() => setDialogOpen(true)}
            >
              {buttonContent}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {shareCount > 0 ? (
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span>Shared with {shareCount} {shareCount === 1 ? 'entity' : 'entities'}</span>
              </div>
            ) : (
              <span>Share this {resourceType}</span>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <ShareDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        resourceType={resourceType}
        resourceId={resourceId}
        resourceName={resourceName}
      />
    </>
  );
}
