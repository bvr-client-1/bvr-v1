'use client';

let audioContext;
let alertIntervalId = null;
let activeNodes = [];

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
    [0, 0.16, 0.34].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 1 ? 'square' : 'sine';
      oscillator.frequency.value = index === 0 ? 880 : index === 1 ? 1175 : 988;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.26);
      oscillator.connect(gain);
      gain.connect(context.destination);
      activeNodes.push(oscillator, gain);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.28);
      oscillator.onended = () => {
        activeNodes = activeNodes.filter((node) => node !== oscillator && node !== gain);
      };
    });
  } catch {
    // Ignore audio failures and still allow visual notifications.
  }
};

export const startNewOrderAlertLoop = async () => {
  if (alertIntervalId) {
    return;
  }

  await playNewOrderAlert();
  alertIntervalId = window.setInterval(() => {
    playNewOrderAlert();
  }, 1400);
};

export const stopNewOrderAlertLoop = () => {
  if (alertIntervalId) {
    window.clearInterval(alertIntervalId);
    alertIntervalId = null;
  }

  activeNodes.forEach((node) => {
    try {
      if (typeof node.stop === 'function') {
        node.stop();
      }
      if (typeof node.disconnect === 'function') {
        node.disconnect();
      }
    } catch {
      // Ignore cleanup failures.
    }
  });
  activeNodes = [];
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
