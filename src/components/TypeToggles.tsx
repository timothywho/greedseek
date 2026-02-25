"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_VISIBLE_TYPES,
  INSTITUTION_TYPES,
  type InstitutionTypeKey,
} from "@/lib/mockData";

type Props = {
  visibleTypes: InstitutionTypeKey[];
  setVisibleTypes: (next: InstitutionTypeKey[]) => void;
  showMoreTypes: boolean;
  setShowMoreTypes: (next: boolean) => void;
};

const ACK_KEY = "jewmap_sensitive_ack";

function isSensitiveType(key: InstitutionTypeKey): boolean {
  return Boolean(INSTITUTION_TYPES.find((t) => t.key === key)?.sensitive);
}

export default function TypeToggles({
  visibleTypes,
  setVisibleTypes,
  showMoreTypes,
  setShowMoreTypes,
}: Props) {
  const [ackOpen, setAckOpen] = useState(false);
  const [pendingShowMore, setPendingShowMore] = useState<boolean | null>(null);

  const baseTypes = useMemo(
    () => INSTITUTION_TYPES.filter((t) => DEFAULT_VISIBLE_TYPES.includes(t.key)),
    []
  );
  const moreTypes = useMemo(
    () => INSTITUTION_TYPES.filter((t) => !DEFAULT_VISIBLE_TYPES.includes(t.key)),
    []
  );

  const hasAck = (): boolean => {
    try {
      return sessionStorage.getItem(ACK_KEY) === "true";
    } catch {
      return false;
    }
  };

  const toggleType = (key: InstitutionTypeKey) => {
    if (visibleTypes.includes(key)) {
      setVisibleTypes(visibleTypes.filter((t) => t !== key));
    } else {
      setVisibleTypes([...visibleTypes, key]);
    }
  };

  const requestShowMore = (next: boolean) => {
    if (!next) {
      setShowMoreTypes(false);
      return;
    }
    if (hasAck()) {
      setShowMoreTypes(true);
      return;
    }
    setPendingShowMore(true);
    setAckOpen(true);
  };

  const requestSensitiveEnable = (key: InstitutionTypeKey) => {
    // Only gate enabling sensitive types
    if (!isSensitiveType(key) || hasAck()) {
      toggleType(key);
      return;
    }
    // Ensure panel is open, but still require acknowledgment
    setPendingShowMore(true);
    setAckOpen(true);
  };

  return (
    <div className="neon-panel pointer-events-auto rounded-2xl p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-white/80">Types</div>

        <label className="flex items-center gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            className="h-4 w-4 accent-white/80"
            checked={showMoreTypes}
            onChange={(e) => requestShowMore(e.target.checked)}
          />
          More types
        </label>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {baseTypes.map((t) => (
          <label
            key={t.key}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white/70 hover:bg-white/10"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-white/80"
              checked={visibleTypes.includes(t.key)}
              onChange={() => toggleType(t.key)}
            />
            {t.label}
          </label>
        ))}
      </div>

      {showMoreTypes && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {moreTypes.map((t) => (
            <label
              key={t.key}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white/70 hover:bg-white/10"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-white/80"
                checked={visibleTypes.includes(t.key)}
                onChange={() => {
                  const willEnable = !visibleTypes.includes(t.key);
                  if (willEnable) requestSensitiveEnable(t.key);
                  else toggleType(t.key);
                }}
              />
              {t.label}
            </label>
          ))}
        </div>
      )}

      {ackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="neon-panel w-full max-w-md rounded-2xl p-4">
            <div className="text-sm font-semibold text-white/90">Acknowledgment</div>
            <p className="mt-2 text-xs leading-snug text-white/80">
              These locations are shown for community services. Do not redistribute.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                onClick={() => {
                  setAckOpen(false);
                  setPendingShowMore(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15"
                onClick={() => {
                  try {
                    sessionStorage.setItem(ACK_KEY, "true");
                  } catch {
                    // ignore
                  }
                  setAckOpen(false);
                  if (pendingShowMore) setShowMoreTypes(true);
                  setPendingShowMore(null);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
