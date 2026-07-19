import { useState, useEffect } from 'react';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  const checkSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (e) {
      console.error('Failed to check push subscription:', e);
    }
  };

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      setPermission(Notification.permission);
      checkSubscription();
    }
  }, []);

  const subscribe = async () => {
    if (!isSupported) return;

    try {
      // 1. Request Permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        console.warn('Push notification permission denied');
        return;
      }

      // 2. Register Service Worker
      const registration = await navigator.serviceWorker.register('/sw.js');

      // 3. Fetch VAPID Key from Backend
      const response = await fetch('/api/v1/system/vapid');
      if (!response.ok) throw new Error('Failed to fetch VAPID key');
      const { publicKey } = await response.json();

      // 4. Subscribe to PushManager
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      // 5. Send Subscription to Backend
      await fetch('/api/v1/system/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });

      setIsSubscribed(true);
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      // It will often fail on LAN without HTTPS.
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        alert('Push notifications require HTTPS when accessing from another device (LAN).');
      }
    }
  };

  return {
    isSupported,
    isSubscribed,
    permission,
    subscribe
  };
}
