import { useState, useEffect, useCallback } from "react";
import { pushNotificationService } from "../services/pushNotificationService";
import { useToast } from "../design-system/Toast";
import { useAuth } from "../auth/useAuth";
import { notifyAlertsUpdated } from "./useAlerts";

export const usePushNotifications = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [loading, setLoading] = useState(false);
  const isDesktop = pushNotificationService.isDesktop();

  const refreshPermission = useCallback(async () => {
    try {
      const state = await pushNotificationService.getPermissionState();
      setPermission(state);
      return state;
    } catch {
      setPermission("denied");
      return "denied";
    }
  }, []);

  useEffect(() => {
    const supported = pushNotificationService.isSupported();
    setIsSupported(supported);
    if (supported) {
      void refreshPermission();
      if (!isDesktop) {
        // Register service worker in background for web push
        void pushNotificationService.registerServiceWorker();
      }
    }
  }, [refreshPermission, isDesktop]);

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      showToast(
        isDesktop
          ? "Desktop notifications are not supported on this platform"
          : "Web Push is not supported on this device/browser",
        "error"
      );
      return false;
    }

    setLoading(true);
    try {
      const dbUserId = user?.db_user?.id;
      const success = await pushNotificationService.subscribe(dbUserId);
      if (success) {
        await refreshPermission();
        showToast(
          isDesktop
            ? "Desktop notifications enabled successfully"
            : "Web Push notifications enabled successfully",
          "success"
        );
        return true;
      }
      return false;
    } catch (err: any) {
      console.error("Push subscribe error:", err);
      await refreshPermission();
      showToast(err.message || "Failed to enable notifications", "error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported, isDesktop, user, refreshPermission, showToast]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const success = await pushNotificationService.unsubscribe();
      if (success) {
        await refreshPermission();
        showToast(
          isDesktop
            ? "Desktop notifications deactivated"
            : "Web Push notifications deactivated",
          "info"
        );
        return true;
      }
      return false;
    } catch (err: any) {
      console.error("Push unsubscribe error:", err);
      showToast(err.message || "Failed to deactivate notifications", "error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [isDesktop, refreshPermission, showToast]);

  const sendTestAlert = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pushNotificationService.sendTestAlert();
      if (res.delivered > 0) {
        showToast("Test notification dispatched to your device!", "success");
      } else {
        showToast(res.message || "No active device subscriptions found", "info");
      }
      notifyAlertsUpdated();
      return res;
    } catch (err: any) {
      console.error("Send test alert error:", err);
      showToast(err.message || "Failed to send test alert", "error");
      return null;
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  return {
    isSupported,
    isDesktop,
    permission,
    loading,
    subscribe,
    unsubscribe,
    refreshPermission,
    sendTestAlert,
  };
};
