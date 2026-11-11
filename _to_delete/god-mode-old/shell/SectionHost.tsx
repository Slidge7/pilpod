import { Activity, Suspense, useEffect, useState } from "react";
import { useNavigation } from "../navigation/Navigation";
import type { SectionId } from "../navigation/route";
import { SectionScope } from "../navigation/SidebarSlot";
import { SECTIONS } from "./sectionRegistry";

/**
 * Mounts sections the first time they are visited and keeps them alive
 * afterwards. A hidden section keeps its state — scroll position, filters,
 * the open playlist — and React renders it at idle priority, so the visible
 * section never waits on one the user is not looking at.
 */
export function SectionHost() {
  const { route } = useNavigation();
  const [visited, setVisited] = useState<ReadonlySet<SectionId>>(
    () => new Set([route.section]),
  );

  useEffect(() => {
    setVisited((v) => (v.has(route.section) ? v : new Set(v).add(route.section)));
  }, [route.section]);

  return (
    <main className="gm-main">
      {SECTIONS.map((s) => {
        const active = s.id === route.section;
        if (!active && !visited.has(s.id)) return null;
        return (
          <Activity key={s.id} mode={active ? "visible" : "hidden"}>
            <SectionScope id={s.id} active={active}>
              <Suspense fallback={<SectionLoading />}>
                <s.View />
              </Suspense>
            </SectionScope>
          </Activity>
        );
      })}
    </main>
  );
}

function SectionLoading() {
  return (
    <div className="gm-view gm-view--loading" aria-busy="true">
      <div className="gm-skeleton gm-skeleton--title" />
      <div className="gm-skeleton gm-skeleton--bar" />
      <div className="gm-skeleton-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="gm-skeleton gm-skeleton--card" />
        ))}
      </div>
    </div>
  );
}
