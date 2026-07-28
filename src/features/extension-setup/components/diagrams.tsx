import type { DiagramId } from "../guides/types";

/**
 * Inline SVG illustrations for guide steps.
 *
 * Deliberately schematic rather than screenshots: browser UI changes with every
 * release, and a stale screenshot is worse than no picture — it makes users
 * hunt for a button that has moved. These show *shape and position*, which
 * survive redesigns.
 */

function StoreAddButton() {
  return (
    <svg viewBox="0 0 220 90" role="img" aria-label="Add to browser button on the store listing">
      <rect x="1" y="1" width="218" height="88" rx="8" className="dg-frame" />
      <circle cx="26" cy="30" r="11" className="dg-fill-soft" />
      <rect x="46" y="22" width="86" height="8" rx="4" className="dg-fill-soft" />
      <rect x="46" y="37" width="54" height="6" rx="3" className="dg-fill-faint" />
      <rect x="140" y="20" width="62" height="24" rx="12" className="dg-accent" />
      <rect x="152" y="29" width="38" height="6" rx="3" className="dg-accent-text" />
      <rect x="16" y="60" width="120" height="5" rx="2.5" className="dg-fill-faint" />
      <rect x="16" y="71" width="80" height="5" rx="2.5" className="dg-fill-faint" />
    </svg>
  );
}

function EdgeAllowBanner() {
  return (
    <svg viewBox="0 0 220 90" role="img" aria-label="Allow extensions from other stores banner">
      <rect x="1" y="1" width="218" height="88" rx="8" className="dg-frame" />
      <rect x="10" y="10" width="200" height="26" rx="6" className="dg-banner" />
      <circle cx="24" cy="23" r="6" className="dg-accent" />
      <rect x="38" y="20" width="104" height="6" rx="3" className="dg-accent-text" />
      <rect x="152" y="15" width="48" height="16" rx="8" className="dg-accent" />
      <rect x="162" y="21" width="28" height="4" rx="2" className="dg-accent-text" />
      <circle cx="26" cy="60" r="10" className="dg-fill-faint" />
      <rect x="44" y="54" width="80" height="6" rx="3" className="dg-fill-faint" />
      <rect x="150" y="52" width="52" height="20" rx="10" className="dg-fill-soft" />
    </svg>
  );
}

function OperaAddon() {
  return (
    <svg viewBox="0 0 220 90" role="img" aria-label="Install Chrome Extensions add-on in Opera">
      <rect x="1" y="1" width="218" height="88" rx="8" className="dg-frame" />
      <rect x="16" y="16" width="76" height="58" rx="8" className="dg-fill-soft" />
      <circle cx="54" cy="38" r="13" className="dg-fill-faint" />
      <rect x="30" y="58" width="48" height="5" rx="2.5" className="dg-fill-faint" />
      <path d="M104 45 h26 m-8 -7 l8 7 l-8 7" className="dg-arrow" fill="none" />
      <rect x="140" y="16" width="64" height="58" rx="8" className="dg-fill-soft" />
      <rect x="152" y="34" width="40" height="18" rx="9" className="dg-accent" />
      <rect x="162" y="41" width="20" height="4" rx="2" className="dg-accent-text" />
    </svg>
  );
}

function VerifyLive() {
  return (
    <svg viewBox="0 0 220 90" role="img" aria-label="PilPod detecting the extension">
      <rect x="1" y="1" width="218" height="88" rx="8" className="dg-frame" />
      <rect x="16" y="20" width="60" height="50" rx="8" className="dg-fill-soft" />
      <rect x="28" y="34" width="36" height="5" rx="2.5" className="dg-fill-faint" />
      <rect x="28" y="45" width="24" height="5" rx="2.5" className="dg-fill-faint" />
      <g className="dg-pulse">
        <path d="M88 45 h40" className="dg-arrow" fill="none" />
        <circle cx="96" cy="45" r="3" className="dg-accent" />
        <circle cx="110" cy="45" r="3" className="dg-accent" />
        <circle cx="124" cy="45" r="3" className="dg-accent" />
      </g>
      <rect x="142" y="20" width="62" height="50" rx="8" className="dg-fill-soft" />
      <path d="M160 45 l8 9 l18 -19" className="dg-check" fill="none" />
    </svg>
  );
}

const DIAGRAMS: Record<DiagramId, () => React.ReactElement> = {
  storeAddButton: StoreAddButton,
  edgeAllowBanner: EdgeAllowBanner,
  operaAddon: OperaAddon,
  verifyLive: VerifyLive,
};

export function StepDiagram({ id }: { id?: DiagramId }) {
  if (!id) return null;
  const Diagram = DIAGRAMS[id];
  if (!Diagram) return null;
  return (
    <div className="xs-diagram" aria-hidden={false}>
      <Diagram />
    </div>
  );
}
