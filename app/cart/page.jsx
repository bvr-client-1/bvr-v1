import { MaintenanceGate } from '../../src/components/MaintenanceGate.jsx';
import CartPage from '../../src/page-components/CartPage.jsx';

export default function Page() {
  return (
    <MaintenanceGate>
      <CartPage />
    </MaintenanceGate>
  );
}
