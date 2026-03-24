import { Suspense, lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';

const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const MenuPage = lazy(() => import('./pages/MenuPage.jsx'));
const CartPage = lazy(() => import('./pages/CartPage.jsx'));
const StatusPage = lazy(() => import('./pages/StatusPage.jsx'));
const OwnerPage = lazy(() => import('./pages/OwnerPage.jsx'));
const KitchenPage = lazy(() => import('./pages/KitchenPage.jsx'));

const Fallback = () => <div className="page-loader">Loading...</div>;

export const router = createBrowserRouter([
  { path: '/', element: <Suspense fallback={<Fallback />}><HomePage /></Suspense> },
  { path: '/menu', element: <Suspense fallback={<Fallback />}><MenuPage /></Suspense> },
  { path: '/cart', element: <Suspense fallback={<Fallback />}><CartPage /></Suspense> },
  { path: '/status', element: <Suspense fallback={<Fallback />}><StatusPage /></Suspense> },
  { path: '/owner', element: <Suspense fallback={<Fallback />}><OwnerPage /></Suspense> },
  { path: '/kitchen', element: <Suspense fallback={<Fallback />}><KitchenPage /></Suspense> },
]);
