package app.neonsnake.wallpaper;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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

    private final ArrayList<Point> body = new ArrayList<>();
    private final ArrayList<Point> cycle = new ArrayList<>();
    private final Map<String, Integer> cycleIndexes = new HashMap<>();
    private int randomState;
    private Point direction = new Point(1, 0);
    private Point food;
    private int foodsEaten;
    private int score;
    private int lastPoints;

    AutonomousSnake(int seed) {
        randomState = seed == 0 ? 0x6d2b79f5 : seed;
        buildCycle();
        reset(false);
    }

    List<Point> body() {
        return body;
    }

    Point food() {
        return food;
    }

    Point direction() {
        return direction;
    }

    int foodsEaten() {
        return foodsEaten;
    }

    int score() {
        return score;
    }

    int lastPoints() {
        return lastPoints;
    }

    boolean foodIsCore() {
        return food != null && (foodsEaten + 1) % 5 == 0;
    }

    void reset(boolean preserveCareer) {
        if (!preserveCareer) {
            foodsEaten = 0;
            score = 0;
            lastPoints = 0;
        }
        body.clear();
        body.add(new Point(10, 10));
        body.add(new Point(9, 10));
        body.add(new Point(8, 10));
        direction = new Point(1, 0);
        placeFood(true);
    }

    boolean step() {
        Point nextDirection = shortestFoodMove();
        Point head = new Point(body.get(0).x + nextDirection.x, body.get(0).y + nextDirection.y);
        boolean growing = food != null && head.x == food.x && head.y == food.y;
        if (!inside(head) || occupied(growing).contains(head.key())) {
            reset(true);
            return false;
        }

        direction = nextDirection;
        body.add(0, head);
        if (!growing) {
            body.remove(body.size() - 1);
            return false;
        }

        foodsEaten += 1;
        lastPoints = foodsEaten % 5 == 0 ? 50 : 10;
        score += lastPoints;
        if (body.size() >= cycle.size()) reset(true);
        else placeFood(false);
        return true;
    }

    private void buildCycle() {
        for (int x = 0; x < GRID; x += 1) cycle.add(new Point(x, 0));
        for (int y = 1; y < GRID; y += 1) {
            if (y % 2 == 1) {
                for (int x = GRID - 1; x >= 1; x -= 1) cycle.add(new Point(x, y));
            } else {
                for (int x = 1; x < GRID; x += 1) cycle.add(new Point(x, y));
            }
        }
        cycle.add(new Point(0, GRID - 1));
        for (int y = GRID - 2; y >= 1; y -= 1) cycle.add(new Point(0, y));
        for (int index = 0; index < cycle.size(); index += 1) {
            cycleIndexes.put(cycle.get(index).key(), index);
        }
    }

    private Point shortestFoodMove() {
        Point head = body.get(0);
        int index = cycleIndexes.get(head.key());
        Point target = cycle.get((index + 1) % cycle.size());
        return new Point(target.x - head.x, target.y - head.y);
    }

    private Set<String> occupied(boolean growing) {
        Set<String> occupied = new HashSet<>();
        int limit = growing ? body.size() : Math.max(0, body.size() - 1);
        for (int index = 0; index < limit; index += 1) {
            occupied.add(body.get(index).key());
        }
        return occupied;
    }

    private boolean inside(Point point) {
        return point.x >= 0 && point.y >= 0 && point.x < GRID && point.y < GRID;
    }

    private void placeFood(boolean initial) {
        Set<String> occupied = occupied(true);
        int headIndex = cycleIndexes.get(body.get(0).key());
        int minimum = initial ? 4 : 10;
        int range = initial ? 1 : 24;
        int desired = minimum + Math.floorMod(nextRandom(), range);
        for (int extra = 0; extra < cycle.size(); extra += 1) {
            Point candidate = cycle.get((headIndex + desired + extra) % cycle.size());
            if (!occupied.contains(candidate.key())) {
                food = candidate;
                return;
            }
        }
        food = null;
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
