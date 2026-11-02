package com.teamtalk.app;

import android.os.Build;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

/**
 * TeamTalk Native Biometrics & Screen Lock Authenticator.
 * Uses Android's official androidx.biometric.BiometricPrompt with BIOMETRIC_STRONG
 * and DEVICE_CREDENTIAL (PIN / Pattern / Password fallback), exactly as WhatsApp does.
 */
@CapacitorPlugin(name = "BiometricAuth")
public class BiometricPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        try {
            BiometricManager biometricManager = BiometricManager.from(getContext());
            int canAuthenticate;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                canAuthenticate = biometricManager.canAuthenticate(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                );
            } else {
                canAuthenticate = biometricManager.canAuthenticate();
            }
            JSObject ret = new JSObject();
            ret.put("available", canAuthenticate == BiometricManager.BIOMETRIC_SUCCESS);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("available", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(getContext());
                BiometricPrompt biometricPrompt = new BiometricPrompt(
                    getActivity(),
                    executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            super.onAuthenticationError(errorCode, errString);
                            JSObject ret = new JSObject();
                            ret.put("success", false);
                            ret.put("error", errString.toString());
                            ret.put("errorCode", errorCode);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            super.onAuthenticationSucceeded(result);
                            JSObject ret = new JSObject();
                            ret.put("success", true);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            super.onAuthenticationFailed();
                            // Keep sensor active for next touch retry
                        }
                    }
                );

                BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("TeamTalk Locked")
                    .setSubtitle("Confirm your fingerprint or screen lock to access TeamTalk");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    builder.setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                    );
                } else {
                    builder.setDeviceCredentialAllowed(true);
                }

                BiometricPrompt.PromptInfo promptInfo = builder.build();
                biometricPrompt.authenticate(promptInfo);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        });
    }
}
