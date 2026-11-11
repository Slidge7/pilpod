import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  initialRoute,
  navigate as nextRoute,
  type Route,
  type SectionId,
  type SectionIntent,
} from "./route";

/** Last section shown, so God Mode reopens where the user left it. */
const STORAGE_KEY = "pilpod-god-mode-section";

type NavigationApi = {
  route: Route;
  navigate: (section: SectionId, intent?: SectionIntent | null) => void;
};

const NavigationContext = createContext<NavigationApi | null>(null);

function readStoredSection(): unknown {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => initialRoute(readStoredSection()));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, route.section);
    } catch {
      /* storage unavailable — reopening on the default section is fine */
    }
  }, [route.section]);

  const navigate = useCallback(
    (section: SectionId, intent: SectionIntent | null = null) =>
      setRoute((r) => nextRoute(r, section, intent)),
    [],
  );

  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  return (
    <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationApi {
  const api = useContext(NavigationContext);
  if (!api) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return api;
}

/**
 * Apply navigation intents addressed to `section`.
 *
 * Runs when the section is (or becomes) visible with an intent it has not
 * applied yet. Sections that are kept alive while hidden do not run effects,
 * so an intent sent while a section was hidden lands the moment it shows.
 */
export function useSectionIntent(
  section: SectionId,
  apply: (intent: SectionIntent) => void,
): void {
  const { route } = useNavigation();
  const applied = useRef(-1);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (route.section !== section || !route.intent) return;
    if (applied.current === route.seq) return;
    applied.current = route.seq;
    applyRef.current(route.intent);
  }, [route, section]);
}
