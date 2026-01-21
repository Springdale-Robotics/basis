import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ListTodo, FileText, Bell } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { listsApi } from '@/api/lists';
import { cn } from '@/lib/utils';

const typeIcons = {
  checklist: ListTodo,
  reminder: Bell,
  notes: FileText,
};

export function ListsPage() {
  const { data: lists, isLoading } = useQuery({
    queryKey: ['lists'],
    queryFn: listsApi.list,
  });

  return (
    <div>
      <PageHeader
        title="Lists"
        description="Manage your lists and reminders"
        actions={
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New List
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !lists?.lists?.length ? (
        <EmptyState
          icon={<ListTodo className="h-12 w-12" />}
          title="No lists yet"
          description="Create your first list to get organized"
          action={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New List
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.lists.map((list) => {
            const Icon = typeIcons[list.type];
            return (
              <Link key={list.id} to={`/lists/${list.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        {list.icon ? (
                          <span>{list.icon}</span>
                        ) : (
                          <Icon className="h-5 w-5 text-muted-foreground" />
                        )}
                        {list.name}
                      </CardTitle>
                      <Badge variant="outline" className="capitalize">
                        {list.type}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Created {new Date(list.createdAt).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
