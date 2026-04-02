// @ts-nocheck — test inputs use Mapbox-specific types (building layers, fog, lights)
// and results are accessed with dynamic property paths; strict TS checking here
// adds noise without catching real bugs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { validate as validateMapbox } from "@mapbox/mapbox-gl-style-spec";
import { mapboxToMaplibre } from "../src/index.js";
import { hslToRgb, transformExpression } from "../src/expressions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load a JSON fixture file.
 * @param {string} name
 */
function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"),
  );
}

/**
 * Assert that a style passes MapLibre validation.
 * Filters out sprite/glyphs/source URL warnings since those reference mapbox:// URLs.
 *
 * @param {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} style
 * @param {string} [label]
 */
function assertValidMaplibreStyle(style, label = "style") {
  const errors = validateStyleMin(style).filter(
    (e) => !e.message.includes("mapbox:"),
  );
  if (errors.length > 0) {
    const messages = errors.map((e) => `  ${e.message}`).join("\n");
    assert.fail(`${label} failed MapLibre validation:\n${messages}`);
  }
}

// ─── Input → expected output cases ──────────────────────────────────

const casesDir = path.join(__dirname, "fixtures", "transform-cases");
const caseFiles = fs
  .readdirSync(casesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("mapboxToMaplibre", () => {
  for (const file of caseFiles) {
    const { description, input, expected, options } = JSON.parse(
      fs.readFileSync(path.join(casesDir, file), "utf8"),
    );
    it(description, () => {
      const inputErrors = validateMapbox(input);
      assert.equal(
        inputErrors.length,
        0,
        `input is not a valid Mapbox style:\n${inputErrors.map((e) => `  ${e.message}`).join("\n")}`,
      );
      assert.deepStrictEqual(mapboxToMaplibre(input, options), expected);
    });
  }

  it("handles legacy stops — migrate converts them to interpolation expressions", () => {
    const result = mapboxToMaplibre({
      version: 8,
      sources: { s: { type: "vector", url: "test" } },
      layers: [
        {
          id: "f",
          type: "fill",
          source: "s",
          paint: {
            "fill-color": {
              stops: [
                [10, "hsl(0, 100%, 50%)"],
                [15, "hsl(120, 100%, 50%)"],
              ],
            },
          },
        },
      ],
    });
    // migrate converts legacy stops to interpolation expressions
    const fillColor = result.layers[0].paint["fill-color"];
    assert.ok(
      Array.isArray(fillColor),
      "legacy stops should be converted to expression",
    );
    assert.equal(
      fillColor[0],
      "interpolate",
      "should be an interpolate expression",
    );
  });
});

// ─── Expression edge cases ──────────────────────────────────────────
// These test transformExpression directly for cases that don't map cleanly
// to full-style input/output fixtures (null returns, literal fallbacks,
// branch cleanup).

describe("expression edge cases", () => {
  it("passes through supported expressions unchanged", () => {
    const exprs = [
      ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 5],
      ["get", "name"],
      ["has", "population"],
      [
        "match",
        ["get", "type"],
        "residential",
        "#aaa",
        "commercial",
        "#bbb",
        "#ccc",
      ],
      ["step", ["zoom"], 0, 10, 1, 15, 2],
    ];
    for (const expr of exprs) {
      assert.deepStrictEqual(transformExpression(expr), expr);
    }
  });

  it("replaces pitch expression with 0", () => {
    assert.equal(transformExpression(["pitch"]), 0);
  });

  it("replaces random expression with 0.5", () => {
    assert.equal(transformExpression(["random"]), 0.5);
  });

  it("returns null for unsupported expressions", () => {
    for (const op of ["config", "measure-light", "distance-from-center"]) {
      assert.equal(
        transformExpression([op, "arg"]),
        null,
        `${op} should return null`,
      );
    }
  });

  it("cleans up case expressions with unsupported conditions", () => {
    const result = transformExpression([
      "case",
      ["config", "showLabels"],
      "visible",
      [">", ["zoom"], 10],
      "visible",
      "none",
    ]);
    assert.deepStrictEqual(result, [
      "case",
      [">", ["zoom"], 10],
      "visible",
      "none",
    ]);
  });

  it("reduces case to fallback if all conditions are unsupported", () => {
    assert.equal(
      transformExpression([
        "case",
        ["config", "a"],
        "x",
        ["config", "b"],
        "y",
        "fallback",
      ]),
      "fallback",
    );
  });

  it("cleans up coalesce with unsupported branches", () => {
    assert.deepStrictEqual(
      transformExpression(["coalesce", ["config", "x"], ["get", "name"]]),
      ["get", "name"],
    );
  });

  it("cleans up match expressions with unsupported output branches", () => {
    const result = transformExpression([
      "match",
      ["get", "type"],
      "a",
      ["config", "colorA"],
      "b",
      "blue",
      "gray",
    ]);
    assert.deepStrictEqual(result, [
      "match",
      ["get", "type"],
      "b",
      "blue",
      "gray",
    ]);
  });

  it("reduces match to fallback if all outputs are unsupported", () => {
    assert.equal(
      transformExpression([
        "match",
        ["get", "type"],
        "a",
        ["config", "x"],
        "b",
        ["config", "y"],
        "fallback",
      ]),
      "fallback",
    );
  });

  it("reduces match to fallback if input is unsupported", () => {
    assert.equal(
      transformExpression([
        "match",
        ["config", "theme"],
        "dark",
        "#000",
        "light",
        "#fff",
        "#888",
      ]),
      "#888",
    );
  });

  it("returns null for coalesce when all branches are unsupported", () => {
    assert.equal(
      transformExpression(["coalesce", ["config", "a"], ["config", "b"]]),
      null,
    );
  });

  it("converts at-interpolated to at", () => {
    assert.deepStrictEqual(
      transformExpression(["at-interpolated", 0, ["literal", [0.5, 1.0]]]),
      ["at", 0, ["literal", [0.5, 1.0]]],
    );
  });
});

describe("hslToRgb", () => {
  const cases = [
    { name: "pure red", args: [0, 1, 0.5], expected: [255, 0, 0] },
    { name: "pure green", args: [120, 1, 0.5], expected: [0, 255, 0] },
    { name: "pure blue", args: [240, 1, 0.5], expected: [0, 0, 255] },
    { name: "white", args: [0, 0, 1], expected: [255, 255, 255] },
    { name: "black", args: [0, 0, 0], expected: [0, 0, 0] },
    {
      name: "yellow-green (h=90)",
      args: [90, 1, 0.5],
      expected: [128, 255, 0],
    },
    { name: "pink (h=330)", args: [330, 1, 0.5], expected: [255, 0, 128] },
  ];
  for (const { name, args, expected } of cases) {
    it(`converts ${name}`, () => {
      assert.deepStrictEqual(hslToRgb(...args), expected);
    });
  }
});

// ─── Large fixture tests ────────────────────────────────────────────

describe("url edge cases", () => {
  it("throws for mapbox:// glyphs URL with unexpected host", () => {
    assert.throws(
      () =>
        mapboxToMaplibre({
          version: 8,
          sources: {},
          layers: [],
          glyphs: "mapbox://notfonts/mapbox/{fontstack}/{range}.pbf",
        }),
      /Expected URL for font resource/,
    );
  });

  it("throws for mapbox:// sprite URL with unexpected host", () => {
    assert.throws(
      () =>
        mapboxToMaplibre({
          version: 8,
          sources: {},
          layers: [],
          sprite: "mapbox://notsprites/mapbox/streets-v12",
        }),
      /Expected URL for sprite resource/,
    );
  });
});

describe("fixture: mapbox-proprietary.json", () => {
  const input = loadFixture("mapbox-proprietary.json");
  const result = mapboxToMaplibre(input);

  it("produces a valid MapLibre style", () => {
    assertValidMaplibreStyle(result, "mapbox-proprietary");
  });

  it("removes unsupported sources", () => {
    assert.ok(result.sources["streets"], "vector source kept");
    assert.ok(result.sources["terrain-dem"], "raster-dem source kept");
    assert.ok(result.sources["satellite"], "raster source kept");
    assert.ok(!("wind-data" in result.sources), "raster-array removed");
    assert.ok(!("buildings-3d" in result.sources), "model source removed");
  });

  it("removes unsupported layer types and keeps supported ones", () => {
    const ids = result.layers.map((l) => l.id);
    for (const id of [
      "background",
      "satellite-raster",
      "hillshade-layer",
      "land",
      "water",
      "roads",
      "buildings-fill",
      "labels",
      "heatmap-layer",
    ]) {
      assert.ok(ids.includes(id), `layer "${id}" should be kept`);
    }
    for (const id of [
      "sky-atmosphere",
      "wind-particles",
      "3d-models",
      "clip-layer",
      "bottom-slot",
    ]) {
      assert.ok(!ids.includes(id), `layer "${id}" should be removed`);
    }
  });

  it("converts building layer to fill-extrusion", () => {
    const building = result.layers.find((l) => l.id === "buildings-procedural");
    assert.ok(building, "building layer should exist");
    assert.equal(building.type, "fill-extrusion");
    assert.equal(building.paint["fill-extrusion-color"], "#cccccc");
  });

  it("strips Mapbox-only paint properties from kept layers", () => {
    const bg = result.layers.find((l) => l.id === "background");
    assert.equal(bg.paint["background-color"], "#f0f0f0");
    assert.ok(!("background-emissive-strength" in bg.paint));

    const roads = result.layers.find((l) => l.id === "roads");
    assert.ok(roads.paint["line-color"], "line-color preserved");
    assert.ok(!("line-border-color" in roads.paint));
    assert.ok(!("line-emissive-strength" in roads.paint));

    const labels = result.layers.find((l) => l.id === "labels");
    assert.ok(!("text-emissive-strength" in labels.paint));
    assert.ok(!("icon-color-saturation" in labels.paint));
  });

  it("transforms expressions in labels layer", () => {
    const labels = result.layers.find((l) => l.id === "labels");
    const textField = labels.layout["text-field"];
    assert.ok(Array.isArray(textField), "text-field is an expression");
    assert.equal(textField[0], "coalesce");
    assert.ok(
      !JSON.stringify(textField).includes("config"),
      "config expressions should be removed",
    );

    const textColor = labels.paint["text-color"];
    assert.ok(Array.isArray(textColor), "text-color is an expression");
    assert.ok(
      !JSON.stringify(textColor).includes("config"),
      "config expressions removed from text-color",
    );
  });

  it("converts hsl color strings in water layer", () => {
    const water = result.layers.find((l) => l.id === "water");
    const str = JSON.stringify(water.paint["fill-color"]);
    assert.ok(!str.includes("hsl("), "hsl() strings should be converted");
    assert.ok(str.includes("rgb("), "should contain rgb() strings");
  });

  it("converts lights array to light object", () => {
    assert.ok(result.light, "light should exist");
    assert.equal(result.light.color, "#ffeedd");
    assert.equal(result.light.intensity, 0.7);
    assert.deepStrictEqual(result.light.position, [1.15, 200, 40]);
  });

  it("converts fog to sky", () => {
    assert.ok(result.sky, "sky should exist");
    assert.equal(result.sky["fog-color"], "#e8e8e8");
    assert.equal(result.sky["sky-color"], "#87ceeb");
  });

  it("preserves terrain and transforms projection", () => {
    assert.deepStrictEqual(result.terrain, {
      source: "terrain-dem",
      exaggeration: 1.5,
    });
    assert.deepStrictEqual(result.projection, { type: "globe" });
  });

  it("transforms mapbox:// URLs to https://api.mapbox.com/", () => {
    assert.equal(
      result.sources["streets"].url,
      "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8.json",
    );
    assert.equal(
      result.sprite,
      "https://api.mapbox.com/styles/v1/mapbox/streets-v12/sprite",
    );
    assert.equal(
      result.glyphs,
      "https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf",
    );
  });

  it("strips Mapbox-only root properties", () => {
    for (const key of ["fog", "lights", "schema", "imports", "fragment"]) {
      assert.ok(!(key in result), `${key} should be removed`);
    }
  });
});

describe("fixture: empty-v9.json", () => {
  const input = loadFixture("empty-v9.json");
  const result = mapboxToMaplibre(input);

  it("produces a valid MapLibre style", () => {
    assertValidMaplibreStyle(result, "empty-v9");
  });

  it("preserves structure", () => {
    assert.equal(result.version, 8);
    assert.equal(result.name, "Empty");
    assert.equal(result.layers.length, 1);
    assert.equal(result.layers[0].type, "background");
  });
});

describe("fixture: basic-v9.json", () => {
  const input = loadFixture("basic-v9.json");
  const result = mapboxToMaplibre(input);

  it("produces a valid MapLibre style", () => {
    assertValidMaplibreStyle(result, "basic-v9");
  });

  it("preserves all layers", () => {
    assert.equal(result.layers.length, input.layers.length);
  });

  it("preserves layer types", () => {
    const types = new Set(result.layers.map((l) => l.type));
    assert.ok(types.has("background"));
    assert.ok(types.has("fill"));
    assert.ok(types.has("line"));
    assert.ok(types.has("symbol"));
  });

  it("preserves source definitions", () => {
    assert.ok(result.sources["mapbox"]);
    assert.equal(result.sources["mapbox"].type, "vector");
  });
});

describe("fixture: bright-v9.json", () => {
  const input = loadFixture("bright-v9.json");
  const result = mapboxToMaplibre(input);

  it("dereferences ref layers", () => {
    const hasRef = result.layers.some((l) => "ref" in l);
    assert.ok(!hasRef, "ref layers should be dereferenced");
    const allHaveType = result.layers.every((l) => l.type);
    assert.ok(allHaveType, "all layers should have a type after dereferencing");
  });

  it("produces a valid MapLibre style", () => {
    assertValidMaplibreStyle(result, "bright-v9");
  });

  it("preserves layer count", () => {
    assert.equal(result.layers.length, input.layers.length);
  });
});
