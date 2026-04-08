import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transformUrls } from "../src/urls.js";

describe("transformUrls", () => {
  it("is a no-op for a MapLibre style with https URLs", () => {
    /** @type {import("../src/index.js").MaplibreStyle} */
    const style = {
      version: 8,
      glyphs: "https://example.com/fonts/{fontstack}/{range}.pbf",
      sprite: "https://example.com/sprites/style",
      sources: {
        osm: {
          type: "vector",
          url: "https://example.com/tiles.json",
        },
      },
      layers: [],
    };
    const original = JSON.parse(JSON.stringify(style));
    const madeChanges = transformUrls(style);

    assert.strictEqual(madeChanges);
    assert.deepStrictEqual(style, original);
  });
});
