export function usernamesMatch(deviceUser: string, upn: string): boolean {
  const left = deviceUser.trim().toLowerCase();
  const right = upn.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const local = right.split("@")[0] ?? "";
  if (left === local) return true;
  const slash = left.includes("\\") ? left.split("\\").pop() ?? "" : left;
  return slash === local || slash === right;
}

export function loginHint(username: string): string | null {
  const value = username.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
  return null;
}
