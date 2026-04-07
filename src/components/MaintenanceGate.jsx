'use client';

import { useAppContext } from '../context/AppContext.jsx';

function MaintenanceScreen() {
  return (
    <main className="maintenance-shell">
      <div className="maintenance-card">
        <img alt="BVR Bangaru Vakili Family Restaurant" className="maintenance-logo" src="/bvr-logo.png" />
        <div className="maintenance-badge">Maintenance Mode</div>
        <h1>We are currently under maintenance</h1>
        <p>Our website will be back soon. Please check again in a little while.</p>
      </div>
    </main>
  );
}

export function MaintenanceGate({ children }) {
  const { restaurantStatus } = useAppContext();

  if (restaurantStatus.maintenanceMode) {
    return <MaintenanceScreen />;
  }

  return children;
}
