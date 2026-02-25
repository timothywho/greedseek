"use client";

import { PRESENCE_TIER_STOPS, type LayerMode } from "@/lib/mockData";

type Props = {
  layer: LayerMode;
};

export default function Legend({ layer }: Props) {
  void layer;
  return (
    <div className="neon-panel pointer-events-auto rounded-2xl p-3">
      <>
        <div className="text-xs font-semibold text-white/80">Presence</div>

        <div className="mt-2 space-y-2">
          {PRESENCE_TIER_STOPS.map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-2 text-xs text-white/70"
            >
              <span
                className="h-3 w-3 rounded-sm"
                style={{ background: s.color }}
              />
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-2 text-[11px] leading-snug text-white/60">
          Shown as density bands (generalized).
        </div>
      </>
    </div>
  );
}
