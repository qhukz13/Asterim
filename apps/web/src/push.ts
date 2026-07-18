export async function subscribeToPushNotifications(token: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported by your browser.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered', registration);

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Notification permission denied.');
      return;
    }

    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    // Fetch VAPID public key
    const vapidRes = await fetch(`${protocol}//${hostname}:3000/api/v1/system/vapid`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const vapidData = await vapidRes.json();
    const publicVapidKey = vapidData.publicKey;

    // Convert VAPID key to Uint8Array
    const padding = '='.repeat((4 - (publicVapidKey.length % 4)) % 4);
    const base64 = (publicVapidKey + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: outputArray
    });

    // Send subscription to server
    await fetch(`${protocol}//${hostname}:3000/api/v1/system/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(subscription)
    });

    alert('Successfully subscribed to Push Notifications!');
  } catch (err) {
    console.error('Failed to subscribe to push notifications', err);
    alert('Failed to subscribe: ' + err);
  }
}
