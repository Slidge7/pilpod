import { describe, it, expect } from "vitest";
import { VaultPanel } from "../../VaultPanel";
import { useVault } from "../../hooks/useVault";
import { SaveTabButton } from "../../components/SaveTabButton";
import { BookmarkList } from "../../components/BookmarkList";
import { PlaylistList } from "../../components/PlaylistList";
import { PlaylistDetail } from "../../components/PlaylistDetail";
import { AddToPlaylistMenu } from "../../components/AddToPlaylistMenu";
import { BookmarkRow } from "../../components/BookmarkRow";
import { EmptyState } from "../../components/EmptyState";

describe("vault module smoke", () => {
  it("all component modules resolve and export functions", () => {
    for (const fn of [
      VaultPanel,
      useVault,
      SaveTabButton,
      BookmarkList,
      PlaylistList,
      PlaylistDetail,
      AddToPlaylistMenu,
      BookmarkRow,
      EmptyState,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});
