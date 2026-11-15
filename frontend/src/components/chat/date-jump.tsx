"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, type Message } from "@/lib/api";
import { errorMessage, toast } from "@/lib/toast";

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The first message on `day` in this channel, or the closest earlier one if that day was quiet.
 * Null when there's nothing that early.
 */
async function firstMessageOn(channelId: string, day: Date): Promise<Message | null> {
  const start = startOfDay(day).getTime();
  const end = new Date(start + DAY).toISOString();
  const page = await api<Message[]>(`/channels/${channelId}/messages?before=${encodeURIComponent(end)}&limit=200`);
  if (!page.length) return null;
  // Newest first: the last message on or after the start of the day is that day's first.
  const sameDay = page.filter((m) => new Date(m.created_at).getTime() >= start);
  return sameDay.length ? sameDay[sameDay.length - 1] : page[0];
}

/** "Today ⌄" on the date divider: jump to today, yesterday, last week, last month or any date. */
export function DateJumpPill({
  label,
  channelId,
  onJumpToLatest,
}: {
  label: string;
  channelId: string;
  onJumpToLatest?: () => Promise<void>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [picking, setPicking] = useState(false);
  const [today] = useState(() => ymd(new Date()));
  const [date, setDate] = useState(today);

  const jump = async (day: Date) => {
    try {
      const m = await firstMessageOn(channelId, day);
      if (!m) {
        toast.info("No messages that far back in this conversation.");
        return;
      }
      router.replace(`${pathname}?msg=${m.id}`, { scroll: false });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't jump to that date"));
    }
  };
  const now = () => new Date();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="relative mx-auto flex items-center gap-1 rounded-full border bg-background px-4 py-1 text-[13px] font-bold shadow-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 data-popup-open:bg-muted">
          {label}
          <ChevronDown className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Jump to…</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void (onJumpToLatest ? onJumpToLatest() : jump(now()))}>Most recent</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void jump(new Date(Date.now() - DAY))}>Yesterday</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void jump(new Date(Date.now() - 7 * DAY))}>Last week</DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const d = now();
                d.setMonth(d.getMonth() - 1);
                void jump(d);
              }}
            >
              Last month
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPicking(true)}>
            <CalendarDays className="size-4" aria-hidden />
            Jump to a specific date…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const [y, m, d] = date.split("-").map(Number);
              if (!y || !m || !d) return;
              setPicking(false);
              void jump(new Date(y, m - 1, d));
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>Jump to a date</DialogTitle>
            </DialogHeader>
            <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} autoFocus required />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPicking(false)}>
                Cancel
              </Button>
              <Button type="submit">Jump</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
