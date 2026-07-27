package app.neonsnake.wallpaper;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class AutonomousSnake {
    static final int GRID = 20;

    static final class Point {
        final int x;
        final int y;

        Point(int x, int y) {
            this.x = x;
            this.y = y;
        }

        String key() {
            return x + "," + y;
        }
    }

    private static final Point[] DIRECTIONS = {
        new Point(0, -1),
        new Point(1, 0),
        new Point(0, 1),
        new Point(-1, 0),
    };

    private final ArrayList<Point> body = new ArrayList<>();
    private final ArrayDeque<Point> recentHeads = new ArrayDeque<>();
    private int randomState;
    private Point direction = new Point(1, 0);
    private Point food;

    AutonomousSnake(int seed) {
        randomState = seed == 0 ? 0x6d2b79f5 : seed;
        reset();
    }

    List<Point> body() {
        return body;
    }

    Point food() {
        return food;
    }

    void reset() {
        body.clear();
        body.add(new Point(10, 10));
        body.add(new Point(9, 10));
        body.add(new Point(8, 10));
        recentHeads.clear();
        direction = new Point(1, 0);
        placeFood();
    }

    void step() {
        Point nextDirection = chooseDirection();
        Point head = nextHead(body.get(0), nextDirection);
        boolean growing = food != null && head.x == food.x && head.y == food.y;
        if (collision(head, growing)) {
            reset();
            return;
        }
        direction = nextDirection;
        body.add(0, head);
        recentHeads.addLast(head);
        while (recentHeads.size() > 160) recentHeads.removeFirst();
        if (growing) {
            placeFood();
        } else {
            body.remove(body.size() - 1);
        }
        if (food == null) reset();
    }

    private Point chooseDirection() {
        Point best = direction;
        long bestScore = Long.MIN_VALUE;
        for (int index = 0; index < DIRECTIONS.length; index += 1) {
            Point candidate = DIRECTIONS[index];
            if (candidate.x == -direction.x && candidate.y == -direction.y) continue;
            Point head = nextHead(body.get(0), candidate);
            boolean growing = food != null && head.x == food.x && head.y == food.y;
            if (collision(head, growing)) continue;
            int area = reachableArea(head, growing);
            int exits = legalExits(head, growing);
            int foodDistance = food == null ? 0 : Math.abs(head.x - food.x) + Math.abs(head.y - food.y);
            int repeatPenalty = 0;
            for (Point recent : recentHeads) {
                if (recent.x == head.x && recent.y == head.y) repeatPenalty += 1;
            }
            long score = area * 10_000L + exits * 900L - foodDistance * 18L - repeatPenalty * 40L - index;
            if (growing) score += 2_000L;
            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        return best;
    }

    private int legalExits(Point head, boolean growing) {
        int exits = 0;
        for (Point candidate : DIRECTIONS) {
            Point next = nextHead(head, candidate);
            if (!collisionFrom(next, growing, head)) exits += 1;
        }
        return exits;
    }

    private int reachableArea(Point start, boolean growing) {
        if (!inside(start)) return 0;
        Set<String> blocked = occupied(growing);
        blocked.remove(start.key());
        ArrayDeque<Point> queue = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        queue.add(start);
        visited.add(start.key());
        while (!queue.isEmpty()) {
            Point cursor = queue.removeFirst();
            for (Point move : DIRECTIONS) {
                Point next = nextHead(cursor, move);
                if (!inside(next)) continue;
                String key = next.key();
                if (blocked.contains(key) || !visited.add(key)) continue;
                queue.addLast(next);
            }
        }
        return visited.size();
    }

    private boolean collision(Point head, boolean growing) {
        return !inside(head) || occupied(growing).contains(head.key());
    }

    private boolean collisionFrom(Point head, boolean growing, Point replacementHead) {
        if (!inside(head)) return true;
        Set<String> occupied = occupied(growing);
        occupied.remove(body.get(0).key());
        occupied.add(replacementHead.key());
        return occupied.contains(head.key());
    }

    private Set<String> occupied(boolean growing) {
        Set<String> occupied = new HashSet<>();
        int limit = growing ? body.size() : Math.max(0, body.size() - 1);
        for (int index = 0; index < limit; index += 1) occupied.add(body.get(index).key());
        return occupied;
    }

    private Point nextHead(Point point, Point move) {
        return new Point(point.x + move.x, point.y + move.y);
    }

    private boolean inside(Point point) {
        return point.x >= 0 && point.y >= 0 && point.x < GRID && point.y < GRID;
    }

    private void placeFood() {
        Set<String> occupied = occupied(true);
        ArrayList<Point> free = new ArrayList<>();
        for (int y = 0; y < GRID; y += 1) {
            for (int x = 0; x < GRID; x += 1) {
                Point point = new Point(x, y);
                if (!occupied.contains(point.key())) free.add(point);
            }
        }
        food = free.isEmpty() ? null : free.get(Math.floorMod(nextRandom(), free.size()));
    }

    private int nextRandom() {
        int value = randomState;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        randomState = value;
        return value;
    }
}
