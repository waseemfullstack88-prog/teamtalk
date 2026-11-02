package com.teamtalk.app;

import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * TeamTalk Android Native Container.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BiometricPlugin.class);
        super.onCreate(savedInstanceState);

        // Safe OEM overlay window handling after WebView and window decor initialization
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                getWindow().setHideOverlayWindows(true);
            } catch (Throwable ignored) {
                // Ignore OEM-specific permission rejections (e.g. Xiaomi MIUI / HyperOS)
            }
        }
    }
}
