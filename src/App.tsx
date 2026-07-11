import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import PayReceive from "./pages/PayReceive";
import PayrollConsole from "./pages/PayrollConsole";
import AttestationWallet from "./pages/AttestationWallet";
import AuditorPortal from "./pages/AuditorPortal";
import Playground from "./pages/Playground";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PayReceive />} />
        <Route path="payroll" element={<PayrollConsole />} />
        <Route path="attestations" element={<AttestationWallet />} />
        <Route path="auditor" element={<AuditorPortal />} />
        <Route path="playground" element={<Playground />} />
      </Route>
    </Routes>
  );
}
