"use client";

import { useEffect, useMemo, useState } from "react";
import {
  advanceSnake,
  createInitialSnakeState,
  Direction,
  GRID_SIZE,
  INITIAL_TICK_MS,
  Point,
  queueDirection,
} from "@/lib/snake";
import { DoubleBezelCard } from "@/components/ui/double-bezel-card";

const DIRECTION_KEYS: Record<string, Direction> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  w: "UP",
  W: "UP",
  a: "LEFT",
  A: "LEFT",
  s: "DOWN",
  S: "DOWN",
  d: "RIGHT",
  D: "RIGHT",
};

const CONTROLS: Array<{ label: string; direction: Direction }> = [
  { label: "Up", direction: "UP" },
  { label: "Left", direction: "LEFT" },
  { label: "Down", direction: "DOWN" },
  { label: "Right", direction: "RIGHT" },
];

function getCellKey(point: Point) {
  return `${point.x},${point.y}`;
}

export function SnakeGame() {
  const [gameState, setGameState] = useState(() => createInitialSnakeState());
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const nextDirection = DIRECTION_KEYS[event.key];

      if (!nextDirection) {
        if (event.key === " ") {
          event.preventDefault();
          setIsRunning((current) => !current);
        }

        if (event.key === "Enter" && gameState.gameOver) {
          event.preventDefault();
          setGameState(createInitialSnakeState());
          setIsRunning(true);
        }

        return;
      }

      event.preventDefault();
      setGameState((current) => queueDirection(current, nextDirection));
      setIsRunning(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState.gameOver]);

  useEffect(() => {
    if (!isRunning || gameState.gameOver) {
      return;
    }

    const timer = window.setInterval(() => {
      setGameState((current) => advanceSnake(current));
    }, INITIAL_TICK_MS);

    return () => window.clearInterval(timer);
  }, [gameState.gameOver, isRunning]);

  useEffect(() => {
    if (gameState.gameOver) {
      setIsRunning(false);
    }
  }, [gameState.gameOver]);

  const snakeCells = useMemo(
    () => new Set(gameState.snake.map((segment) => getCellKey(segment))),
    [gameState.snake],
  );

  const cells = useMemo(
    () =>
      Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => ({
        x: index % GRID_SIZE,
        y: Math.floor(index / GRID_SIZE),
      })),
    [],
  );

  function handleDirection(direction: Direction) {
    setGameState((current) => queueDirection(current, direction));
    setIsRunning(true);
  }

  function handleRestart() {
    setGameState(createInitialSnakeState());
    setIsRunning(false);
  }

  return (
    <DoubleBezelCard className="w-full max-w-5xl" innerClassName="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-accent-300">
            Classic Snake
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Snake</h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-400 md:text-base">
            Eat food, grow longer, and avoid walls or your own tail. Arrow keys
            and WASD both work.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Score
            </p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {gameState.score}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Status
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-200">
              {gameState.gameOver
                ? "Game over"
                : isRunning
                  ? "Running"
                  : "Paused"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-4">
          <div
            className="grid aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-900"
            style={{
              gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
            }}
          >
            {cells.map((cell) => {
              const key = getCellKey(cell);
              const isSnake = snakeCells.has(key);
              const isHead = getCellKey(gameState.snake[0]) === key;
              const isFood = getCellKey(gameState.food) === key;

              return (
                <div
                  key={key}
                  className={`border border-white/5 ${
                    isHead
                      ? "bg-accent-300"
                      : isSnake
                        ? "bg-accent-500"
                        : isFood
                          ? "bg-amber-400"
                          : "bg-zinc-900"
                  }`}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Controls</p>
            <p className="mt-2 text-sm text-zinc-400">
              Use Arrow keys or WASD. Press space to pause or resume.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsRunning((current) => !current)}
                className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-accent-400"
              >
                {isRunning ? "Pause" : "Start"}
              </button>
              <button
                type="button"
                onClick={handleRestart}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Restart
              </button>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Touch Controls</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {CONTROLS.map((control) => (
                <button
                  key={control.direction}
                  type="button"
                  onClick={() => handleDirection(control.direction)}
                  className="rounded-xl border border-white/10 bg-zinc-900 px-4 py-4 text-sm font-medium text-zinc-200 transition hover:border-accent/50 hover:bg-zinc-800"
                >
                  {control.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
            <p className="font-medium text-white">Manual check</p>
            <ul className="mt-3 space-y-2">
              <li>Food should increase the score and length by one.</li>
              <li>Moving into a wall or your body should end the run.</li>
              <li>Restart should reset score, snake length, and food.</li>
            </ul>
          </div>
        </div>
      </div>

      {gameState.gameOver ? (
        <div className="rounded-[1.5rem] border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          Game over. Press restart or hit Enter to try again.
        </div>
      ) : null}
    </DoubleBezelCard>
  );
}
