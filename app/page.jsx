import { MaintenanceGate } from '../src/components/MaintenanceGate.jsx';
import HomePage from '../src/page-components/HomePage.jsx';

export default function Page() {
  return (
    <MaintenanceGate>
      <HomePage />
    </MaintenanceGate>
  );
}
