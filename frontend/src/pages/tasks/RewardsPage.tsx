import { useQuery } from '@tanstack/react-query';
import { Star, Trophy, TrendingUp, Award } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { tasksApi } from '@/api/tasks';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function RewardsPage() {
  const { user } = useAuth();

  const { data: userRewardsData, isLoading: rewardsLoading } = useQuery({
    queryKey: ['rewards', user?.id],
    queryFn: () => tasksApi.getUserRewards(user!.id),
    enabled: !!user?.id,
  });

  const { data: achievementsData, isLoading: achievementsLoading } = useQuery({
    queryKey: ['achievements'],
    queryFn: tasksApi.getAchievements,
  });

  const { data: userAchievementsData } = useQuery({
    queryKey: ['user-achievements', user?.id],
    queryFn: () => tasksApi.getUserAchievements(user!.id),
    enabled: !!user?.id,
  });

  const isLoading = rewardsLoading || achievementsLoading;

  const userRewards = userRewardsData?.reward;
  const allAchievements = achievementsData?.achievements || [];
  const earnedAchievements = userAchievementsData?.achievements || [];
  const availableAchievements = allAchievements.filter(
    (a) => !earnedAchievements.find((ea) => ea.id === a.id)
  );

  return (
    <div>
      <PageHeader
        title="Rewards"
        description="Track your achievements and points"
      />

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
                  <Star className="h-6 w-6 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{userRewards?.points || 0}</p>
                  <p className="text-sm text-muted-foreground">Current Points</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{userRewards?.lifetimePoints || 0}</p>
                  <p className="text-sm text-muted-foreground">Lifetime Points</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
                  <Trophy className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{earnedAchievements.length}</p>
                  <p className="text-sm text-muted-foreground">Achievements</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Earned Achievements */}
          {earnedAchievements.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-4 text-lg font-semibold">Your Achievements</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {earnedAchievements.map((achievement) => (
                  <Card key={achievement.id} className="border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="text-3xl">{achievement.icon}</div>
                        <div>
                          <h3 className="font-semibold">{achievement.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {achievement.description}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Earned {achievement.earnedAt && formatDate(achievement.earnedAt)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Available Achievements */}
          <div>
            <h2 className="mb-4 text-lg font-semibold">Available Achievements</h2>
            {availableAchievements.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Award className="h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-4 text-muted-foreground">
                    You've earned all available achievements!
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {availableAchievements.map((achievement) => {
                  const progress = achievement.pointsRequired
                    ? Math.min(
                        ((userRewards?.lifetimePoints || 0) / achievement.pointsRequired) * 100,
                        100
                      )
                    : 0;

                  return (
                    <Card key={achievement.id} className="opacity-75">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="text-3xl grayscale">{achievement.icon}</div>
                          <div className="flex-1">
                            <h3 className="font-semibold">{achievement.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {achievement.description}
                            </p>
                            {achievement.pointsRequired && (
                              <div className="mt-2">
                                <Progress value={progress} className="h-2" />
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {userRewards?.lifetimePoints || 0} / {achievement.pointsRequired} points
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
