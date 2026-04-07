'use client';

let audioContext;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) {
    audioContext = new Context();
  }
  return audioContext;
};

export const primeAlertAudio = async () => {
  try {
    const context = getAudioContext();
    if (context?.state === 'suspended') {
      await context.resume();
    }
  } catch {
    // Browser audio unlock can fail silently.
  }
};

export const playNewOrderAlert = async () => {
  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    [0, 0.18].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = index === 0 ? 880 : 1175;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.24);
    });
  } catch {
    // Ignore audio failures and still allow visual notifications.
  }
};

export const requestStaffNotificationPermission = async () => {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'default') {
    return window?.Notification?.permission || 'unsupported';
  }

  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
};

export const notifyNewOrder = (title, body) => {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    const notification = new Notification(title, { body, silent: true });
    window.setTimeout(() => notification.close(), 5000);
  } catch {
    // Ignore browser notification failures.
  }
};
