export default function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{subtitle}</p>
    </div>
  );
}
