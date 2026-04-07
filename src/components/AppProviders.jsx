'use client';

import { AppProvider } from '../context/AppContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';

export function AppProviders({ children }) {
  return (
    <ToastProvider>
      <AppProvider>{children}</AppProvider>
    </ToastProvider>
  );
}
