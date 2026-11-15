"use client";

import { Hash, Loader2, Plus, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SearchPanel } from "@/components/chat/search-panel";
import { Button } from "@/components/ui/button";
import { BrowseChannelsDialog, NewChannelDialog, NewDMDialog } from "@/components/workspace/dialogs";
import { useWorkspace } from "@/components/workspace/provider";
import { useIsMobile } from "@/lib/use-is-mobile";

type DialogName = "browse" | "channel" | "dm" | null;

/** /w/:id → open #general (or the first channel); otherwise a welcome screen to get started. */
export function WorkspaceIndex() {
  const ws = useWorkspace();
  const { workspaceId, channels, channelsLoaded } = ws;
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogName>(null);
  const close = (open: boolean) => !open && setDialog(null);

  // Phones show the channel list here (see Shell); only bigger screens jump into #general.
  const mobile = useIsMobile();
  const target = mobile
    ? undefined
    : (channels.find((c) => c.name === "general" && c.is_member) ?? channels.find((c) => c.is_member));
  useEffect(() => {
    if (target) router.replace(`/w/${workspaceId}/c/${target.id}`);
  }, [target, workspaceId, router]);

  const waiting = !channelsLoaded || !!target;

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-6">
        {waiting ? (
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : (
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-mention text-mention-foreground">
              <Hash className="size-8" />
            </div>
            <h1 className="text-2xl font-black [overflow-wrap:anywhere]">
              Welcome to {ws.workspace?.name ?? "your workspace"}
            </h1>
            <p className="mt-1 text-[15px] text-muted-foreground">
              You&apos;re not in any channels yet. Join one to see what your team is talking about, or start a conversation.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setDialog("browse")} className="bg-send text-white hover:bg-send/90">
                <Hash className="size-4" /> Browse channels
              </Button>
              <Button variant="outline" onClick={() => setDialog("channel")}>
                <Plus className="size-4" /> Create a channel
              </Button>
              <Button variant="outline" onClick={() => setDialog("dm")}>
                <SquarePen className="size-4" /> Start a DM
              </Button>
            </div>
          </div>
        )}
      </section>

      {ws.searchQuery && <SearchPanel key={ws.searchQuery} query={ws.searchQuery} onClose={() => ws.setSearchQuery(null)} />}

      <BrowseChannelsDialog open={dialog === "browse"} onOpenChange={close} />
      <NewChannelDialog open={dialog === "channel"} onOpenChange={close} />
      <NewDMDialog open={dialog === "dm"} onOpenChange={close} />
    </div>
  );
}
