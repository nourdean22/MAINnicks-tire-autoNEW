import { ChatIsland } from "@/features/chat-v2/components/chat-island";

export const metadata = {
  title: "NOUR OS | Chat",
  description: "The primary cognitive interface for NOURCITY.",
};

export default function ChatPage() {
  return (
    <main className="h-[100dvh] w-full overflow-hidden bg-zinc-950">
      <ChatIsland />
    </main>
  );
}
