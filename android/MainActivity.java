package dev.pixeldeity.app;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

/**
 * Pixel Deity — native Android shell.
 *
 * The whole game engine ships in assets/ and runs in a fullscreen WebView,
 * but this is a real app: launcher icon, immersive fullscreen, and saves
 * written to app-private storage through SaveBridge (so they never depend
 * on WebView cookie/localStorage policies and survive OS cleanups).
 */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new SaveBridge(this), "PixelDeityBridge");
        setContentView(web);
        hideBars();
        web.loadUrl("file:///android_asset/index.html");
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    public void onBackPressed() {
        // never lose a god mid-smite: background instead of destroy
        moveTaskToBack(true);
    }

    @Override
    protected void onPause() {
        // force a save whenever the app loses the foreground
        if (web != null) web.evaluateJavascript("try{PixelDeity.save()}catch(e){}", null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Key/value store backed by files in app-private storage. */
    public static class SaveBridge {
        private final File dir;

        public SaveBridge(Context c) {
            dir = new File(c.getFilesDir(), "saves");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }

        private File fileFor(String key) {
            return new File(dir, key.replaceAll("[^A-Za-z0-9._-]", "_"));
        }

        @JavascriptInterface
        public String getItem(String key) {
            File f = fileFor(key);
            if (!f.exists()) return null;
            StringBuilder sb = new StringBuilder((int) Math.max(64, f.length()));
            try (BufferedReader r = new BufferedReader(new FileReader(f))) {
                char[] buf = new char[16384];
                int n;
                while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
                return sb.toString();
            } catch (IOException e) {
                return null;
            }
        }

        @JavascriptInterface
        public void setItem(String key, String value) {
            // write-then-rename so a mid-write kill can't corrupt the save
            File tmp = new File(dir, fileFor(key).getName() + ".tmp");
            try (FileWriter w = new FileWriter(tmp)) {
                w.write(value);
            } catch (IOException e) {
                return;
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(fileFor(key));
        }

        @JavascriptInterface
        public void removeItem(String key) {
            //noinspection ResultOfMethodCallIgnored
            fileFor(key).delete();
        }
    }
}
