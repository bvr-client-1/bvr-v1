import { MaintenanceGate } from '../../src/components/MaintenanceGate.jsx';
import StatusPage from '../../src/page-components/StatusPage.jsx';

export default function Page() {
  return (
    <MaintenanceGate>
      <StatusPage />
    </MaintenanceGate>
  );
}
