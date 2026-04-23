import { describe, expect, it } from "vitest";
import {
  collectAppcastSparkleVersionErrors,
  collectControlUiAssetPayloadErrors,
} from "../scripts/release-check.ts";

function makeItem(shortVersion: string, sparkleVersion: string): string {
  return `<item><title>${shortVersion}</title><sparkle:shortVersionString>${shortVersion}</sparkle:shortVersionString><sparkle:version>${sparkleVersion}</sparkle:version></item>`;
}

describe("collectAppcastSparkleVersionErrors", () => {
  it("accepts legacy 9-digit calver builds before lane-floor cutover", () => {
    const xml = `<rss><channel>${makeItem("2026.2.26", "202602260")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toEqual([]);
  });

  it("requires lane-floor builds on and after lane-floor cutover", () => {
    const xml = `<rss><channel>${makeItem("2026.3.1", "202603010")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toEqual([
      "appcast item '2026.3.1' has sparkle:version 202603010 below lane floor 2026030190.",
    ]);
  });

  it("accepts canonical stable lane builds on and after lane-floor cutover", () => {
    const xml = `<rss><channel>${makeItem("2026.3.1", "2026030190")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toEqual([]);
  });
});

describe("collectControlUiAssetPayloadErrors", () => {
  it("rejects packs that ship the dashboard HTML without the asset payload", () => {
    expect(collectControlUiAssetPayloadErrors(["dist/control-ui/index.html"])).toEqual([
      "missing Control UI asset payload under dist/control-ui/assets/",
    ]);
  });

  it("accepts packs that ship dashboard assets", () => {
    expect(
      collectControlUiAssetPayloadErrors([
        "dist/control-ui/index.html",
        "dist/control-ui/assets/index-Bu8rSoJV.js",
      ]),
    ).toEqual([]);
  });
});
