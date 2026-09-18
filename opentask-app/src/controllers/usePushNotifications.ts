import { useState, useEffect, useCallback } from "react";
import { pushNotificationService } from "../services/pushNotificationService";
import { useToast } from "../design-system/Toast";
import { useAuth } from "../auth/useAuth";

export const usePushNotifications = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supported = pushNotificationService.isSupported();
    setIsSupported(supported);
    if (supported) {
      setPermission(pushNotificationService.getPermissionState());
      // Register service worker in background
      void pushNotificationService.registerServiceWorker();
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      showToast("Web Push is not supported on this device/browser", "error");
      return false;
    }

    setLoading(true);
    try {
      const dbUserId = user?.db_user?.id;
      const success = await pushNotificationService.subscribe(dbUserId);
      if (success) {
        setPermission(pushNotificationService.getPermissionState());
        showToast("Web Push Notifications enabled successfully", "success");
        return true;
      }
      return false;
    } catch (err: any) {
      console.error("Push subscribe error:", err);
      setPermission(pushNotificationService.getPermissionState());
      showToast(err.message || "Failed to enable push notifications", "error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported, user, showToast]);

  const sendTestAlert = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pushNotificationService.sendTestAlert();
      if (res.delivered > 0) {
        showToast("Test notification dispatched to your device!", "success");
      } else {
        showToast(res.message || "No active device subscriptions found", "info");
      }
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
    permission,
    loading,
    subscribe,
    sendTestAlert,
  };
};
