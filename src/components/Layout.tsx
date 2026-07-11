import { NavLink, Outlet } from "react-router-dom";
import { useVault } from "../context/VaultContext";
import WalletButton from "./WalletButton";

const nav = [
  { to: "/", label: "Pay / Receive", end: true },
  { to: "/payroll", label: "Payroll Console" },
  { to: "/attestations", label: "Attestation Wallet" },
  { to: "/auditor", label: "Auditor Portal" },
  { to: "/playground", label: "SDK Playground" },
];

function VaultStatus() {
  const { status, vault, lock } = useVault();
  if (status === "unlocked" && vault) {
    return (
      <span className="flex items-center gap-2">
        <span
          className="rounded-lg bg-surface-raised px-3 py-1.5 font-mono text-xs text-shielded"
          title={vault.address}
        >
          {vault.address.slice(0, 12)}…{vault.address.slice(-4)}
        </span>
        <button
          onClick={lock}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          Lock
        </button>
      </span>
    );
  }
  return (
    <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-slate-500">
      Vault {status === "locked" ? "locked" : "not created"}
    </span>
  );
}

export default function Layout() {
  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
        <div className="px-6 py-5">
          <div className="text-lg font-semibold tracking-tight text-white">
            Attesta
          </div>
          <div className="mt-1 text-xs text-slate-400">
            private to the public, provable to the auditor
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-surface-raised font-medium text-white"
                    : "text-slate-400 hover:bg-surface-raised/60 hover:text-slate-200"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-6 py-5 text-[11px] leading-relaxed text-slate-500">
          v1 privacy scope: <span className="text-shielded">amounts are shielded</span>;
          participants and timing are public. Proofs are generated locally —
          secrets never leave this device.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-line bg-surface px-8 py-3">
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-slate-400">
            Local simulation
          </span>
          <VaultStatus />
          <WalletButton />
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
