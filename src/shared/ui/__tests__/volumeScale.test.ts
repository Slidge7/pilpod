import { describe, expect, it } from "vitest";
import {
  TAB_VOL_MAX,
  trackFractionToVolume,
  volFillTone,
  volumeToTrackFraction,
} from "../volumeScale";

describe("volumeScale", () => {
  it("uses TAB_VOL_MAX = 150", () => {
    expect(TAB_VOL_MAX).toBe(150);
  });

  describe("volumeToTrackFraction", () => {
    it("maps 0-100% to the first half of the track (0.0 - 0.5)", () => {
      expect(volumeToTrackFraction(0)).toBe(0);
      expect(volumeToTrackFraction(50)).toBeCloseTo(0.25);
      expect(volumeToTrackFraction(100)).toBeCloseTo(0.5);
    });

    it("maps 100-150% to the second half of the track (0.5 - 1.0)", () => {
      expect(volumeToTrackFraction(125)).toBeCloseTo(0.75);
      expect(volumeToTrackFraction(150)).toBeCloseTo(1.0);
    });

    it("clamps out-of-range values", () => {
      expect(volumeToTrackFraction(-20)).toBe(0);
      expect(volumeToTrackFraction(300)).toBeCloseTo(1.0);
    });
  });

  describe("trackFractionToVolume", () => {
    it("maps fractions 0.0 - 0.5 to volumes 0 - 100%", () => {
      expect(trackFractionToVolume(0)).toBe(0);
      expect(trackFractionToVolume(0.25)).toBe(50);
      expect(trackFractionToVolume(0.5)).toBe(100);
    });

    it("maps fractions 0.5 - 1.0 to volumes 100 - 150%", () => {
      expect(trackFractionToVolume(0.75)).toBe(125);
      expect(trackFractionToVolume(1.0)).toBe(150);
    });

    it("rounds to steps of 5%", () => {
      // 0.51: in second half, raw = 100 + (0.01 / 0.5) * 50 = 101 -> rounds to 100
      expect(trackFractionToVolume(0.51)).toBe(100);
      // 0.53: in second half, raw = 100 + (0.03 / 0.5) * 50 = 103 -> rounds to 105
      expect(trackFractionToVolume(0.53)).toBe(105);
    });
  });

  describe("volFillTone", () => {
    it("returns muted for 0", () => {
      expect(volFillTone(0)).toBe("muted");
    });

    it("returns normal for 1 - 100", () => {
      expect(volFillTone(1)).toBe("normal");
      expect(volFillTone(50)).toBe("normal");
      expect(volFillTone(100)).toBe("normal");
    });

    it("returns boost for 101 - 125", () => {
      expect(volFillTone(101)).toBe("boost");
      expect(volFillTone(115)).toBe("boost");
      expect(volFillTone(125)).toBe("boost");
    });

    it("returns high for > 125", () => {
      expect(volFillTone(126)).toBe("high");
      expect(volFillTone(135)).toBe("high");
      expect(volFillTone(150)).toBe("high");
    });
  });
});
