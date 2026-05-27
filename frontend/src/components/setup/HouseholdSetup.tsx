import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { setupHouseholdFormSchema, type SetupHouseholdFormData } from '@/types/forms';

interface HouseholdSetupProps {
  onSubmit: (data: SetupHouseholdFormData) => void;
  isLoading: boolean;
}

const timezones = Intl.supportedValuesOf('timeZone');

export function HouseholdSetup({ onSubmit, isLoading }: HouseholdSetupProps) {
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SetupHouseholdFormData>({
    resolver: zodResolver(setupHouseholdFormSchema),
    defaultValues: {
      name: '',
      timezone: defaultTimezone,
    },
  });

  const timezone = watch('timezone');

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Home className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Create Your Household</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up your household to get started with Basis.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Household Name</Label>
          <Input
            id="name"
            placeholder="My Home"
            {...register('name')}
          />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Select
            value={timezone}
            onValueChange={(value) => setValue('timezone', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.timezone && (
            <p className="text-sm text-destructive">{errors.timezone.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </form>
    </div>
  );
}
