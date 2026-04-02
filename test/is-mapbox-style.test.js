// @ts-nocheck — test inputs intentionally include Mapbox-specific properties
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMapboxStyle, mapboxToMaplibre } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"),
  );
}

describe("isMapboxStyle", () => {
  it("returns true for style with mapbox:// glyphs URL", () => {
    assert.ok(
      isMapboxStyle({
        version: 8,
        sources: {},
        layers: [],
        glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
      }),
    );
  });

  it("returns true for style with mapbox:// sprite URL", () => {
    assert.ok(
      isMapboxStyle({
        version: 8,
        sources: {},
        layers: [],
        sprite: "mapbox://sprites/mapbox/streets-v12",
      }),
    );
  });

  it("returns true for style with mapbox:// source URL", () => {
    assert.ok(
      isMapboxStyle({
        version: 8,
        sources: {
          streets: {
            type: "vector",
            url: "mapbox://mapbox.mapbox-streets-v8",
          },
        },
        layers: [],
      }),
    );
  });

  it("returns true for style with mapbox-only root property", () => {
    assert.ok(isMapboxStyle({ version: 8, sources: {}, layers: [], fog: {} }));
    assert.ok(
      isMapboxStyle({ version: 8, sources: {}, layers: [], lights: [] }),
    );
    assert.ok(
      isMapboxStyle({ version: 8, sources: {}, layers: [], imports: [] }),
    );
  });

  it("returns false for a plain MapLibre style", () => {
    assert.ok(
      !isMapboxStyle({
        version: 8,
        sources: {
          osm: { type: "vector", url: "https://example.com/tiles.json" },
        },
        layers: [{ id: "bg", type: "background" }],
        glyphs: "https://example.com/fonts/{fontstack}/{range}.pbf",
        sprite: "https://example.com/sprites/style",
      }),
    );
  });

  it("returns false for a minimal style with no URLs", () => {
    assert.ok(!isMapboxStyle({ version: 8, sources: {}, layers: [] }));
  });

  it("returns true for the mapbox-proprietary fixture", () => {
    const input = loadFixture("mapbox-proprietary.json");
    assert.ok(isMapboxStyle(input));
  });

  it("returns false for the transformed output of mapbox-proprietary fixture", () => {
    const input = loadFixture("mapbox-proprietary.json");
    const result = mapboxToMaplibre(input);
    assert.ok(!isMapboxStyle(result));
  });

  it("returns true for the basic-v9 fixture", () => {
    const input = loadFixture("basic-v9.json");
    assert.ok(isMapboxStyle(input));
  });

  it("returns true for the bright-v9 fixture", () => {
    const input = loadFixture("bright-v9.json");
    assert.ok(isMapboxStyle(input));
  });

  it("returns true for the empty-v9 fixture", () => {
    const input = loadFixture("empty-v9.json");
    assert.ok(isMapboxStyle(input));
  });
});
