export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startRadiusListener } = await import("./server/listener");
  await startRadiusListener();
}
