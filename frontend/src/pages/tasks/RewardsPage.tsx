import { useQuery } from '@tanstack/react-query';
import { Star, TrendingUp, History } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksApi } from '@/api/tasks';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/utils';

export function RewardsPage() {
  const { user } = useAuth();

  const { data: userRewardsData, isLoading: rewardsLoading } = useQuery({
    queryKey: ['rewards', user?.id],
    queryFn: () => tasksApi.getUserRewards(user!.id),
    enabled: !!user?.id,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['reward-history', user?.id],
    queryFn: () => tasksApi.getUserRewardsHistory(user!.id),
    enabled: !!user?.id,
  });

  const isLoading = rewardsLoading || historyLoading;
  const userRewards = userRewardsData?.reward;
  const history = historyData?.history || [];

  return (
    <div>
      <PageHeader title="Rewards" description="Track points earned from chores" />

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <div className="mb-8 grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-muted">
                  <Star className="h-6 w-6 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{userRewards?.points || 0}</p>
                  <p className="text-sm text-muted-foreground">Current Points</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-muted">
                  <TrendingUp className="h-6 w-6 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {userRewards?.lifetimePoints || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">Lifetime Points</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="h-5 w-5" />
                History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No reward history yet. Complete a chore worth points to start.
                </p>
              ) : (
                <ul className="divide-y">
                  {history.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between py-3"
                    >
                      <div>
                        <p className="font-medium">{entry.reason}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(entry.createdAt)}
                        </p>
                      </div>
                      <span
                        className={
                          entry.pointsChange > 0
                            ? 'font-semibold text-success'
                            : 'font-semibold text-destructive'
                        }
                      >
                        {entry.pointsChange > 0 ? '+' : ''}
                        {entry.pointsChange}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
