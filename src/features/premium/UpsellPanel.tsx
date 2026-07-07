import { useState } from "react";
import type { PremiumStatus } from "./types";
import { inactiveReasonLabel } from "./entitlement";

interface Props {
  status: PremiumStatus | null;
  featureTitle: string;
  featureBlurb: string;
  activating: boolean;
  activationError: string | null;
  onActivate: (key: string) => void;
}

/**
 * Shown in place of a premium feature when the user isn't entitled.
 * Styled with the existing --pilpod design tokens; fits the 350px window.
 */
export function UpsellPanel({
  status,
  featureTitle,
  featureBlurb,
  activating,
  activationError,
  onActivate,
}: Props) {
  const [key, setKey] = useState("");
  const reason = inactiveReasonLabel(status);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "32px 20px",
        textAlign: "center",
        color: "var(--pilpod-text)",
      }}
    >
      <div style={{ fontSize: 28 }} aria-hidden>
        🔒
      </div>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{featureTitle}</div>
      <div style={{ fontSize: 13, color: "var(--pilpod-text-muted)", lineHeight: 1.5 }}>
        {featureBlurb}
      </div>
      {reason && (
        <div style={{ fontSize: 12, color: "var(--pilpod-text-secondary)" }}>{reason}</div>
      )}
      <form
        style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim() && !activating) onActivate(key.trim());
        }}
      >
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your license key (PP1.…)"
          spellCheck={false}
          autoComplete="off"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--pilpod-border)",
            background: "var(--pilpod-bg-elevated)",
            color: "var(--pilpod-text)",
          }}
        />
        <button
          type="submit"
          disabled={activating || key.trim().length === 0}
          style={{
            padding: "8px 10px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid var(--pilpod-border-strong)",
            background: "var(--pilpod-bg-elevated)",
            color: "var(--pilpod-text)",
            cursor: activating ? "wait" : "pointer",
            opacity: activating || key.trim().length === 0 ? 0.6 : 1,
          }}
        >
          {activating ? "Activating…" : "Activate Premium"}
        </button>
      </form>
      {activationError && (
        <div role="alert" style={{ fontSize: 12, color: "#dc2626" }}>
          {activationError}
        </div>
      )}
    </div>
  );
}
