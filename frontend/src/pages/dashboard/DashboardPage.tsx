import { TodayHero } from '@/components/dashboard/TodayHero';
import { TodaysEventsCard } from '@/components/dashboard/TodaysEventsCard';
import { TodaysMealsCard } from '@/components/dashboard/TodaysMealsCard';
import { UseUpSoonCard } from '@/components/dashboard/UseUpSoonCard';
import { PendingTasksCard } from '@/components/dashboard/PendingTasksCard';

export function DashboardPage() {
  return (
    <div>
      <TodayHero />

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <TodaysEventsCard />
        <TodaysMealsCard />
        <UseUpSoonCard />
        <PendingTasksCard />
      </div>
    </div>
  );
}
