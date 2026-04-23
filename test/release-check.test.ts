import { describe, expect, it } from "vitest";
import { collectControlUiAssetPayloadErrors } from "../scripts/release-check.ts";

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
