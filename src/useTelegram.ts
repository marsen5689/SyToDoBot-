import { useEffect } from 'react';
import { telegram } from './api';

export function useTelegram() {
  useEffect(() => {
    const app = telegram();
    function applyTheme() {
      const dark = app?.colorScheme === 'dark' || (!app && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      const canvas = dark ? '#0a0a0a' : '#f5f5f5';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas);
      if (app?.isVersionAtLeast('6.1')) {
        app.setHeaderColor(app.isVersionAtLeast('6.9') ? canvas : 'bg_color');
        app.setBackgroundColor(canvas);
      }
      if (app?.isVersionAtLeast('7.10')) app.setBottomBarColor?.(canvas);
    }
    function applyInsets() {
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const inset = (app?.safeAreaInset?.[side] ?? 0) + (app?.contentSafeAreaInset?.[side] ?? 0);
        document.documentElement.style.setProperty(`--safe-${side}`, `${inset}px`);
      }
    }
    applyTheme(); applyInsets(); app?.ready(); app?.expand();
    app?.onEvent('themeChanged', applyTheme);
    app?.onEvent('safeAreaChanged', applyInsets);
    app?.onEvent('contentSafeAreaChanged', applyInsets);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    return () => {
      app?.offEvent('themeChanged', applyTheme);
      app?.offEvent('safeAreaChanged', applyInsets);
      app?.offEvent('contentSafeAreaChanged', applyInsets);
      media.removeEventListener('change', applyTheme);
    };
  }, []);
}
export function haptic(type: 'light' | 'success' | 'error') {
  const app = telegram();
  if (!app?.isVersionAtLeast('6.1')) return;
  if (type === 'light') app.HapticFeedback.impactOccurred('light');
  else app.HapticFeedback.notificationOccurred(type);
}
