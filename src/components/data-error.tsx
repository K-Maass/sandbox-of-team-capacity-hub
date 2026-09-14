export function DataError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Could not load shared data.";

  return (
    <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
      <p className="text-sm font-medium text-destructive">Shared data could not be loaded</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
