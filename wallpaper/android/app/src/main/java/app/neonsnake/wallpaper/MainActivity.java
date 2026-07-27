package app.neonsnake.wallpaper;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setGravity(Gravity.CENTER);
        return view;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(this, 28), dp(this, 28), dp(this, 28), dp(this, 28));
        layout.setBackgroundColor(Color.rgb(6, 7, 11));

        TextView title = text(getString(R.string.setup_title), 34, Color.rgb(173, 255, 102));
        title.setLetterSpacing(.18f);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        titleParams.bottomMargin = dp(this, 10);
        layout.addView(title, titleParams);

        TextView subtitle = text(getString(R.string.setup_subtitle), 12, Color.rgb(102, 227, 255));
        subtitle.setLetterSpacing(.12f);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subtitleParams.bottomMargin = dp(this, 28);
        layout.addView(subtitle, subtitleParams);

        TextView body = text(getString(R.string.setup_body), 16, Color.rgb(202, 210, 218));
        body.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bodyParams.bottomMargin = dp(this, 34);
        layout.addView(body, bodyParams);

        Button apply = new Button(this);
        apply.setText(R.string.set_wallpaper);
        apply.setTextColor(Color.rgb(6, 7, 11));
        apply.setBackgroundColor(Color.rgb(173, 255, 102));
        apply.setOnClickListener(view -> {
            Intent intent = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
            intent.putExtra(
                WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
                new ComponentName(this, NeonWallpaperService.class)
            );
            startActivity(intent);
        });
        layout.addView(apply, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(this, 58)
        ));

        setContentView(layout);
    }
}
