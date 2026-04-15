export const GRID_SIZE = 16;
export const INITIAL_DIRECTION = "RIGHT" as const;
export const INITIAL_TICK_MS = 140;

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export interface Point {
  x: number;
  y: number;
}

export interface SnakeState {
  gridSize: number;
  snake: Point[];
  direction: Direction;
  pendingDirection: Direction;
  food: Point;
  score: number;
  gameOver: boolean;
}

const DIRECTION_VECTORS: Record<Direction, Point> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT",
};

export function pointsEqual(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

export function isOutOfBounds(point: Point, gridSize: number) {
  return (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= gridSize ||
    point.y >= gridSize
  );
}

export function getNextHead(head: Point, direction: Direction): Point {
  const vector = DIRECTION_VECTORS[direction];
  return {
    x: head.x + vector.x,
    y: head.y + vector.y,
  };
}

export function isOppositeDirection(current: Direction, next: Direction) {
  return OPPOSITE_DIRECTION[current] === next;
}

export function createInitialSnake(gridSize: number): Point[] {
  const center = Math.floor(gridSize / 2);
  return [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];
}

export function getAvailableFoodCells(
  snake: Point[],
  gridSize: number,
): Point[] {
  const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
  const cells: Point[] = [];

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      if (!occupied.has(`${x},${y}`)) {
        cells.push({ x, y });
      }
    }
  }

  return cells;
}

export function placeFood(
  snake: Point[],
  gridSize: number,
  random: () => number = Math.random,
): Point {
  const availableCells = getAvailableFoodCells(snake, gridSize);

  if (availableCells.length === 0) {
    return snake[0];
  }

  const index = Math.floor(random() * availableCells.length);
  return availableCells[index];
}

export function createInitialSnakeState(
  gridSize = GRID_SIZE,
  random: () => number = Math.random,
): SnakeState {
  const snake = createInitialSnake(gridSize);

  return {
    gridSize,
    snake,
    direction: INITIAL_DIRECTION,
    pendingDirection: INITIAL_DIRECTION,
    food: placeFood(snake, gridSize, random),
    score: 0,
    gameOver: false,
  };
}

export function queueDirection(
  state: SnakeState,
  nextDirection: Direction,
): SnakeState {
  if (
    isOppositeDirection(state.direction, nextDirection) ||
    isOppositeDirection(state.pendingDirection, nextDirection)
  ) {
    return state;
  }

  return {
    ...state,
    pendingDirection: nextDirection,
  };
}

export function advanceSnake(
  state: SnakeState,
  random: () => number = Math.random,
): SnakeState {
  if (state.gameOver) {
    return state;
  }

  const direction = state.pendingDirection;
  const nextHead = getNextHead(state.snake[0], direction);
  const ateFood = pointsEqual(nextHead, state.food);
  const bodyToCheck = ateFood ? state.snake : state.snake.slice(0, -1);

  if (
    isOutOfBounds(nextHead, state.gridSize) ||
    bodyToCheck.some((segment) => pointsEqual(segment, nextHead))
  ) {
    return {
      ...state,
      direction,
      pendingDirection: direction,
      gameOver: true,
    };
  }

  const nextSnake = [nextHead, ...state.snake];

  if (!ateFood) {
    nextSnake.pop();
  }

  const nextFood = ateFood
    ? placeFood(nextSnake, state.gridSize, random)
    : state.food;

  return {
    ...state,
    snake: nextSnake,
    direction,
    pendingDirection: direction,
    food: nextFood,
    score: ateFood ? state.score + 1 : state.score,
    gameOver: false,
  };
}
