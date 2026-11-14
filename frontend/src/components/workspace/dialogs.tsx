"use client";

import { Hash, Lock, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Channel } from "@/lib/api";
import { cn } from "@/lib/utils";

import { MemberPicker } from "./member-picker";
import { useWorkspace } from "./provider";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function useSubmit() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run, setError };
}

export function NewChannelDialog({ open, onOpenChange }: DialogProps) {
  const { workspaceId, me, reloadChannels } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const { error, busy, run } = useSubmit();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const ch = await api<Channel>(`/workspaces/${workspaceId}/channels`, {
        method: "POST",
        body: JSON.stringify({ name, kind: isPrivate ? "private" : "public", member_ids: memberIds }),
      });
      await reloadChannels();
      onOpenChange(false);
      setName("");
      setMemberIds([]);
      router.push(`/w/${workspaceId}/c/${ch.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create a channel</DialogTitle>
            <DialogDescription>Channels are where conversations happen around a topic.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              placeholder="e.g. marketing"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, ""))}
              maxLength={80}
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: false, icon: Hash, title: "Public", desc: "Anyone in the workspace" },
              { value: true, icon: Lock, title: "Private", desc: "Only invited people" },
            ].map((o) => (
              <button
                type="button"
                key={o.title}
                onClick={() => setIsPrivate(o.value)}
                className={cn(
                  "rounded-md border p-3 text-left text-sm",
                  isPrivate === o.value ? "border-primary ring-1 ring-primary" : "hover:bg-muted",
                )}
              >
                <o.icon className="mb-1 size-4" />
                <div className="font-medium">{o.title}</div>
                <div className="text-xs text-muted-foreground">{o.desc}</div>
              </button>
            ))}
          </div>
          {isPrivate && (
            <div className="space-y-2">
              <Label>Add people</Label>
              <MemberPicker selected={memberIds} onChange={setMemberIds} exclude={me ? [me.id] : []} />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !name}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewDMDialog({ open, onOpenChange }: DialogProps) {
  const { workspaceId, me, reloadChannels, members, isAdmin } = useWorkspace();
  const nobodyElse = !members.some((m) => m.user_id !== me?.id && !m.is_bot);
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const { error, busy, run } = useSubmit();

  const submit = () =>
    run(async () => {
      const ch = await api<Channel>(`/workspaces/${workspaceId}/dms`, {
        method: "POST",
        body: JSON.stringify({ user_ids: ids }),
      });
      await reloadChannels();
      onOpenChange(false);
      setIds([]);
      router.push(`/w/${workspaceId}/c/${ch.id}`);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Pick one person for a direct message, or several for a group.</DialogDescription>
        </DialogHeader>
        {nobodyElse ? (
          <div className="rounded-lg border border-dashed p-5 text-center">
            <p className="font-semibold">You&apos;re the only one here so far</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin ? "Invite your team to start a conversation." : "Ask a workspace admin to invite your teammates."}
            </p>
            {isAdmin && (
              <Button
                className="mt-4 bg-send text-white hover:bg-send/90"
                onClick={() => {
                  onOpenChange(false);
                  router.push(`/w/${workspaceId}/settings?tab=invitations`);
                }}
              >
                Invite people
              </Button>
            )}
          </div>
        ) : (
          <>
            <MemberPicker selected={ids} onChange={setIds} exclude={me ? [me.id] : []} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={submit} disabled={busy || ids.length === 0}>
                Open conversation
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InviteDialog({ open, onOpenChange }: DialogProps) {
  const { workspaceId, workspace, reloadMembers } = useWorkspace();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [done, setDone] = useState("");
  const { error, busy, run } = useSubmit();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDone("");
    run(async () => {
      await api(`/workspaces/${workspaceId}/members`, { method: "POST", body: JSON.stringify({ email, role }) });
      await reloadMembers();
      setDone(`${email} was added to ${workspace?.name}.`);
      setEmail("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite people to {workspace?.name}</DialogTitle>
            <DialogDescription>They need a Worklio account already. Email invites are coming soon.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin")}
              className="rounded-md border bg-background px-2 text-sm"
              aria-label="Role"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {done && <p className="text-sm text-emerald-600">{done}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              Add to workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BrowseChannelsDialog({ open, onOpenChange }: DialogProps) {
  const { workspaceId, channels, reloadChannels } = useWorkspace();
  const router = useRouter();
  const { error, run } = useSubmit();
  const [creating, setCreating] = useState(false);
  const browsable = channels.filter((c) => c.kind === "public");

  const openChannel = (c: Channel) =>
    run(async () => {
      if (!c.is_member) {
        await api(`/channels/${c.id}/join`, { method: "POST" });
        await reloadChannels();
      }
      onOpenChange(false);
      router.push(`/w/${workspaceId}/c/${c.id}`);
    });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8">
            <DialogTitle>Browse channels</DialogTitle>
            {/* Like Slack: "Add channels" leads here, so creating one is right at the top. */}
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                setCreating(true);
              }}
              className="shrink-0 gap-1 bg-send text-white hover:bg-send/90"
            >
              <Plus className="size-4" aria-hidden />
              Create a channel
            </Button>
          </DialogHeader>
          {browsable.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No public channels yet. Create the first one.
            </p>
          )}
          <div className={cn("max-h-[min(20rem,60dvh)] divide-y overflow-y-auto rounded-md border", !browsable.length && "hidden")}>
            {browsable.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Hash className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  {c.topic && <div className="truncate text-xs text-muted-foreground">{c.topic}</div>}
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  variant={c.is_member ? "outline" : "default"}
                  onClick={() => openChannel(c)}
                >
                  {c.is_member ? "Open" : "Join"}
                </Button>
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
      <NewChannelDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function AddChannelMembersDialog({
  open,
  onOpenChange,
  channel,
  currentMemberIds,
  onAdded,
}: DialogProps & { channel: Channel; currentMemberIds: string[]; onAdded: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const { error, busy, run } = useSubmit();

  const submit = () =>
    run(async () => {
      for (const user_id of ids) {
        await api(`/channels/${channel.id}/members`, { method: "POST", body: JSON.stringify({ user_id }) });
      }
      setIds([]);
      onAdded();
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add people to #{channel.name}</DialogTitle>
        </DialogHeader>
        <MemberPicker selected={ids} onChange={setIds} exclude={currentMemberIds} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={submit} disabled={busy || ids.length === 0}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
