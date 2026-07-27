package app.neonsnake.wallpaper;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.service.wallpaper.WallpaperService;
import android.view.SurfaceHolder;

import java.util.List;

public final class NeonWallpaperService extends WallpaperService {
    @Override
    public Engine onCreateEngine() {
        return new NeonEngine();
    }

    private final class NeonEngine extends Engine {
        private static final long STEP_MS = 112L;
        private final Handler handler = new Handler(Looper.getMainLooper());
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();
        private final AutonomousSnake snake = new AutonomousSnake((int) System.nanoTime());
        private final Runnable frame = this::drawFrame;
        private final PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        private boolean visible;
        private boolean surfaceReady;
        private long lastStepAt;
        private long lastPickupAt;
        private int pickupX;
        private int pickupY;
        private int width;
        private int height;

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setOffsetNotificationsEnabled(false);
            setTouchEventsEnabled(false);
            lastStepAt = android.os.SystemClock.uptimeMillis();
        }

        @Override
        public void onVisibilityChanged(boolean nextVisible) {
            visible = nextVisible;
            handler.removeCallbacks(frame);
            if (visible && surfaceReady) {
                lastStepAt = android.os.SystemClock.uptimeMillis();
                handler.post(frame);
            }
        }

        @Override
        public void onSurfaceCreated(SurfaceHolder holder) {
            super.onSurfaceCreated(holder);
            surfaceReady = true;
            if (visible) handler.post(frame);
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int nextWidth, int nextHeight) {
            super.onSurfaceChanged(holder, format, nextWidth, nextHeight);
            width = nextWidth;
            height = nextHeight;
            drawFrame();
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            surfaceReady = false;
            handler.removeCallbacks(frame);
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onDestroy() {
            handler.removeCallbacks(frame);
            super.onDestroy();
        }

        private void drawFrame() {
            handler.removeCallbacks(frame);
            if (!visible || !surfaceReady || width <= 0 || height <= 0) return;

            long now = android.os.SystemClock.uptimeMillis();
            if (now - lastStepAt >= STEP_MS) {
                int catchUp = 0;
                while (now - lastStepAt >= STEP_MS && catchUp < 3) {
                    if (snake.step()) {
                        AutonomousSnake.Point head = snake.body().get(0);
                        pickupX = head.x;
                        pickupY = head.y;
                        lastPickupAt = lastStepAt + STEP_MS;
                    }
                    lastStepAt += STEP_MS;
                    catchUp += 1;
                }
                if (catchUp == 3 && now - lastStepAt >= STEP_MS) lastStepAt = now;
            }

            Canvas canvas = null;
            try {
                canvas = getSurfaceHolder().lockCanvas();
                if (canvas != null) render(canvas, now);
            } finally {
                if (canvas != null) getSurfaceHolder().unlockCanvasAndPost(canvas);
            }

            boolean powerSave = powerManager != null && powerManager.isPowerSaveMode();
            handler.postDelayed(frame, powerSave ? 67L : 42L);
        }

        private void render(Canvas canvas, long now) {
            float board = Math.min(width * .9f, height * .72f);
            float tile = board / AutonomousSnake.GRID;
            float left = (width - board) / 2f;
            float top = (height - board) / 2f + height * .04f;

            drawBackground(canvas, now, left, top, board, tile);
            drawFood(canvas, now, left, top, tile);
            drawSnake(canvas, now, left, top, tile);
            drawPickupEffects(canvas, now, left, top, tile);
            drawHud(canvas);
        }

        private void drawBackground(Canvas canvas, long now, float left, float top, float board, float tile) {
            paint.clearShadowLayer();
            paint.setShader(new RadialGradient(
                width * (.32f + (float) Math.sin(now * .00008) * .06f),
                height * .26f,
                Math.max(width, height) * .88f,
                new int[]{Color.rgb(25, 58, 33), Color.rgb(6, 14, 8), Color.rgb(2, 5, 3)},
                new float[]{0f, .44f, 1f},
                Shader.TileMode.CLAMP
            ));
            canvas.drawRect(0, 0, width, height, paint);
            paint.setShader(null);

            paint.setStyle(Paint.Style.FILL);
            for (int index = 0; index < 26; index += 1) {
                float x = ((index * 223 + 91) % 997) / 997f * width;
                float baseY = ((index * 167 + 47) % 991) / 991f * height;
                float y = (baseY + (float) Math.sin(now * .0004 + index) * 8f + height) % height;
                paint.setColor(index % 6 == 0
                    ? Color.argb(22, 102, 227, 255)
                    : Color.argb(16, 173, 255, 102));
                canvas.drawCircle(x, y, index % 7 == 0 ? 2f : 1f, paint);
            }

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1f);
            paint.setColor(Color.argb(34, 173, 255, 102));
            canvas.drawRect(left, top, left + board, top + board, paint);
            paint.setStrokeWidth(Math.max(2f, tile * .05f));
            paint.setColor(Color.argb(110, 173, 255, 102));
            float corner = Math.max(14f, tile * .8f);
            corner(canvas, left, top, corner, 1, 1);
            corner(canvas, left + board, top, corner, -1, 1);
            corner(canvas, left, top + board, corner, 1, -1);
            corner(canvas, left + board, top + board, corner, -1, -1);
        }

        private void corner(Canvas canvas, float x, float y, float size, int sx, int sy) {
            path.reset();
            path.moveTo(x, y + sy * size);
            path.lineTo(x, y);
            path.lineTo(x + sx * size, y);
            canvas.drawPath(path, paint);
        }

        private void drawFood(Canvas canvas, long now, float left, float top, float tile) {
            AutonomousSnake.Point food = snake.food();
            if (food == null) return;
            boolean core = snake.foodIsCore();
            int color = core ? Color.rgb(255, 209, 102) : Color.rgb(255, 118, 87);
            float pulse = 1f + (float) Math.sin(now / 150f) * .1f;
            float x = left + (food.x + .5f) * tile;
            float y = top + (food.y + .5f) * tile;
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(2f, tile * .055f));
            paint.setColor((88 << 24) | (color & 0x00ffffff));
            paint.setShadowLayer(tile * .8f, 0, 0, color);
            canvas.drawCircle(x, y, tile * .42f * pulse, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(color);
            if (core) {
                float size = tile * .27f * pulse;
                path.reset();
                path.moveTo(x, y - size);
                path.lineTo(x + size, y);
                path.lineTo(x, y + size);
                path.lineTo(x - size, y);
                path.close();
                canvas.drawPath(path, paint);
            } else {
                canvas.drawCircle(x, y, tile * .21f * pulse, paint);
            }
            paint.clearShadowLayer();
        }

        private void drawSnake(Canvas canvas, long now, float left, float top, float tile) {
            List<AutonomousSnake.Point> body = snake.body();
            if (body.isEmpty()) return;
            path.reset();
            for (int index = 0; index < body.size(); index += 1) {
                AutonomousSnake.Point segment = body.get(index);
                float x = left + (segment.x + .5f) * tile;
                float y = top + (segment.y + .5f) * tile;
                if (index == 0) path.moveTo(x, y);
                else path.lineTo(x, y);
            }
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setShadowLayer(tile * .25f, 0, 0, Color.rgb(173, 255, 102));
            paint.setColor(Color.argb(38, 173, 255, 102));
            paint.setStrokeWidth(tile * 1.08f);
            canvas.drawPath(path, paint);
            paint.clearShadowLayer();
            paint.setColor(Color.rgb(41, 75, 44));
            paint.setStrokeWidth(tile * .82f);
            canvas.drawPath(path, paint);
            paint.setColor(Color.rgb(141, 221, 85));
            paint.setStrokeWidth(tile * .64f);
            canvas.drawPath(path, paint);
            paint.setColor(Color.argb(60, 242, 255, 223));
            paint.setStrokeWidth(Math.max(2f, tile * .08f));
            canvas.drawPath(path, paint);
            drawSnakeHead(canvas, body.get(0), snake.direction(), left, top, tile);
        }

        private void drawSnakeHead(
            Canvas canvas,
            AutonomousSnake.Point head,
            AutonomousSnake.Point direction,
            float left,
            float top,
            float tile
        ) {
            float x = left + (head.x + .5f) * tile;
            float y = top + (head.y + .5f) * tile;
            float angle = (float) Math.toDegrees(Math.atan2(direction.y, direction.x));
            canvas.save();
            canvas.rotate(angle, x, y);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(46, 173, 255, 102));
            canvas.drawCircle(x, y, tile * .52f, paint);
            paint.setColor(Color.rgb(212, 255, 168));
            paint.setShadowLayer(tile * .35f, 0, 0, Color.rgb(173, 255, 102));
            canvas.drawCircle(x, y, tile * .39f, paint);
            paint.clearShadowLayer();
            paint.setColor(Color.rgb(18, 32, 21));
            canvas.drawCircle(x + tile * .16f, y - tile * .12f, Math.max(2f, tile * .055f), paint);
            canvas.drawCircle(x + tile * .16f, y + tile * .12f, Math.max(2f, tile * .055f), paint);
            canvas.restore();
        }

        private void drawPickupEffects(Canvas canvas, long now, float left, float top, float tile) {
            long elapsed = now - lastPickupAt;
            if (lastPickupAt == 0 || elapsed < 0 || elapsed > 900L) return;
            float progress = Math.min(1f, elapsed / 900f);
            float x = left + (pickupX + .5f) * tile;
            float y = top + (pickupY + .5f) * tile;
            int color = snake.lastPoints() == 50 ? Color.rgb(255, 209, 102) : Color.rgb(255, 118, 87);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(2f, tile * .05f));
            paint.setColor((Math.round((1f - progress) * 190f) << 24) | (color & 0x00ffffff));
            paint.setShadowLayer(tile * .4f, 0, 0, color);
            canvas.drawCircle(x, y, tile * (.2f + progress * 1.4f), paint);
            paint.clearShadowLayer();
        }

        private void drawHud(Canvas canvas) {
            float density = getResources().getDisplayMetrics().density;
            float left = Math.max(28f * density, width * .055f);
            float top = Math.max(36f * density, height * .055f);
            paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(125, 147, 132));
            paint.setTextSize(9f * density);
            paint.setLetterSpacing(.16f);
            canvas.drawText("AUTOPILOT  •  ONLINE", left, top, paint);
            paint.setColor(Color.rgb(173, 255, 102));
            paint.setTextSize(18f * density);
            paint.setLetterSpacing(.08f);
            canvas.drawText(String.format("%05d", snake.score()), left, top + 28f * density, paint);
            paint.setColor(Color.rgb(237, 245, 237));
            paint.setTextSize(10f * density);
            canvas.drawText(
                "SCORE     CHAIN " + String.format("%03d", snake.body().size())
                    + "     EATEN " + String.format("%03d", snake.foodsEaten()),
                left,
                top + 48f * density,
                paint
            );
            paint.setLetterSpacing(0f);
        }
    }
}
