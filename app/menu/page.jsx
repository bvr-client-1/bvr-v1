import { MaintenanceGate } from '../../src/components/MaintenanceGate.jsx';
import MenuPage from '../../src/page-components/MenuPage.jsx';

export default function Page() {
  return (
    <MaintenanceGate>
      <MenuPage />
    </MaintenanceGate>
  );
}
