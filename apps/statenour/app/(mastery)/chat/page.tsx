import { ChatIsland } from "@/features/chat-v2/components/chat-island";

export const metadata = {
  title: "NOUR OS | Chat",
  description: "The primary cognitive interface for NOURCITY.",
};

export default function ChatPage() {
  // div, not <main>: the (mastery) layout already renders the page's single
  // <main id="main-content"> landmark, and nesting a second main inside it is
  // invalid HTML. fixed inset-0 also takes the island out of the padded feed
  // flow — the layout's bottom-chrome padding stacked under the 100dvh box
  // and left ~128px of dead scroll; the composer's pb-safe is now the one
  // bottom reservation.
  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-950">
      <ChatIsland />
    </div>
  );
}
