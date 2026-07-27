package app.neonsnake.wallpaper;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
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
        private final Handler handler = new Handler(Looper.getMainLooper());
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final AutonomousSnake snake = new AutonomousSnake((int) System.nanoTime());
        private final Runnable frame = this::drawFrame;
        private final PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        private boolean visible;
        private boolean surfaceReady;
        private long lastStepAt;
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
            if (now - lastStepAt >= 132L) {
                int catchUp = 0;
                while (now - lastStepAt >= 132L && catchUp < 3) {
                    snake.step();
                    lastStepAt += 132L;
                    catchUp += 1;
                }
                if (catchUp == 3 && now - lastStepAt >= 132L) lastStepAt = now;
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
            float board = Math.min(width, height) * .86f;
            float tile = board / AutonomousSnake.GRID;
            float left = (width - board) / 2f;
            float top = (height - board) / 2f;

            paint.clearShadowLayer();
            paint.setShader(new RadialGradient(
                width * .38f,
                height * .3f,
                Math.max(width, height) * .82f,
                new int[]{Color.rgb(29, 34, 50), Color.rgb(8, 10, 16), Color.rgb(3, 4, 7)},
                new float[]{0f, .48f, 1f},
                Shader.TileMode.CLAMP
            ));
            canvas.drawRect(0, 0, width, height, paint);
            paint.setShader(null);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1f);
            paint.setColor(Color.argb(18, 102, 227, 255));
            for (int index = 0; index <= AutonomousSnake.GRID; index += 1) {
                float offset = index * tile;
                canvas.drawLine(left + offset, top, left + offset, top + board, paint);
                canvas.drawLine(left, top + offset, left + board, top + offset, paint);
            }

            AutonomousSnake.Point food = snake.food();
            if (food != null) {
                float pulse = .84f + (float) Math.sin(now * .004) * .16f;
                float x = left + (food.x + .5f) * tile;
                float y = top + (food.y + .5f) * tile;
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.rgb(255, 118, 87));
                paint.setShadowLayer(tile * .9f, 0, 0, Color.rgb(255, 118, 87));
                canvas.drawCircle(x, y, Math.max(3f, tile * .17f * pulse), paint);
            }

            List<AutonomousSnake.Point> body = snake.body();
            paint.setStyle(Paint.Style.FILL);
            paint.setShadowLayer(tile * .65f, 0, 0, Color.rgb(173, 255, 102));
            for (int index = body.size() - 1; index >= 0; index -= 1) {
                AutonomousSnake.Point segment = body.get(index);
                float x = left + (segment.x + .5f) * tile;
                float y = top + (segment.y + .5f) * tile;
                float alpha = Math.max(.2f, 1f - index / (float) Math.max(body.size(), 12));
                int color = index == 0
                    ? Color.rgb(244, 255, 233)
                    : index % 3 == 0 ? Color.rgb(102, 227, 255) : Color.rgb(173, 255, 102);
                paint.setColor((Math.round(alpha * 255) << 24) | (color & 0x00ffffff));
                canvas.drawCircle(x, y, index == 0 ? tile * .25f : tile * .19f, paint);
            }
            paint.clearShadowLayer();
        }
    }
}
