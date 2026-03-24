import { RouterProvider } from 'react-router-dom';
import { AppProvider } from './context/AppContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { router } from './routes.jsx';

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </ToastProvider>
  );
}
