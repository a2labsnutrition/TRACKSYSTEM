export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-64 rounded bg-panel-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-panel" />
        ))}
      </div>
      <div className="h-80 rounded-xl border border-border bg-panel" />
    </div>
  );
}
