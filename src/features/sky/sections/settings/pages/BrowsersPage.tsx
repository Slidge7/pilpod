import { ExtensionSetupPanel, useExtensionSetup } from "../../../../extension-setup";

/**
 * Browser setup — the same panel the dashboard shows, so its guide and its
 * wording never drift apart. It does its (expensive) scan only while this
 * page is on screen.
 */
export function BrowsersPage({ visible }: { visible: boolean }) {
  const api = useExtensionSetup({ active: visible });
  return (
    <div className="sky-settings-embed">
      <ExtensionSetupPanel api={api} />
    </div>
  );
}
