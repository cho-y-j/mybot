import { SnakeGame } from "@/components/snake/snake-game";

export const metadata = {
  title: "Snake | MyHome",
  description: "A minimal classic Snake game built inside the existing app.",
};

export default function SnakePage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
        <SnakeGame />
      </div>
      <div className="grain-overlay" />
    </main>
  );
}
