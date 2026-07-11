import type { ReactNode } from "react";

export default function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-6 ${className}`}
    >
      {title && (
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
