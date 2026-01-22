import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AddTimerDialogProps {
  onAdd: (name: string, minutes: number, seconds: number) => void;
  trigger?: React.ReactNode;
}

const QUICK_TIMES = [
  { label: '1 min', minutes: 1, seconds: 0 },
  { label: '5 min', minutes: 5, seconds: 0 },
  { label: '10 min', minutes: 10, seconds: 0 },
  { label: '15 min', minutes: 15, seconds: 0 },
  { label: '30 min', minutes: 30, seconds: 0 },
  { label: '45 min', minutes: 45, seconds: 0 },
];

export function AddTimerDialog({ onAdd, trigger }: AddTimerDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');

  const handleQuickAdd = (mins: number, secs: number) => {
    const timerName = name.trim() || `${mins} minute timer`;
    onAdd(timerName, mins, secs);
    handleClose();
  };

  const handleCustomAdd = () => {
    const mins = parseInt(minutes) || 0;
    const secs = parseInt(seconds) || 0;
    if (mins <= 0 && secs <= 0) return;

    const timerName = name.trim() || `${mins}:${String(secs).padStart(2, '0')} timer`;
    onAdd(timerName, mins, secs);
    handleClose();
  };

  const handleClose = () => {
    setOpen(false);
    setName('');
    setMinutes('');
    setSeconds('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Add Timer
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add Timer</DialogTitle>
          <DialogDescription>
            Set a custom timer or use a quick preset.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Timer Name */}
          <div className="space-y-2">
            <Label htmlFor="timer-name">Timer Name (optional)</Label>
            <Input
              id="timer-name"
              placeholder="e.g., Boil pasta"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Quick Presets */}
          <div className="space-y-2">
            <Label>Quick Add</Label>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_TIMES.map((time) => (
                <Button
                  key={time.label}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickAdd(time.minutes, time.seconds)}
                >
                  {time.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Time */}
          <div className="space-y-2">
            <Label>Custom Time</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  max="999"
                  placeholder="0"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="text-center"
                />
                <p className="text-xs text-muted-foreground text-center mt-1">
                  minutes
                </p>
              </div>
              <span className="text-xl font-bold">:</span>
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  max="59"
                  placeholder="0"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value)}
                  className="text-center"
                />
                <p className="text-xs text-muted-foreground text-center mt-1">
                  seconds
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCustomAdd}
            disabled={!minutes && !seconds}
          >
            Add Timer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
