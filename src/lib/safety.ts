export const K_ANONYMITY_THRESHOLD = 3;

export function isKAnonymous(count: number): boolean {
  return count >= K_ANONYMITY_THRESHOLD;
}

// 0..1 glow intensity (no UI numbers; used only for styling)
export function glowIntensity(count: number): number {
  // Clamp count into a soft range
  const c = Math.max(0, Math.min(count, 30));
  // Ease curve
  const t = c / 30;
  return 0.25 + 0.75 * (t * t);
}
