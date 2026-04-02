/**
 * @module mapbox-style-transformer
 *
 * Transforms a Mapbox GL style document into a MapLibre GL compatible style.
 * Removes unsupported properties while preserving visual appearance where possible.
 */

/** @typedef {import('@mapbox/mapbox-gl-style-spec').StyleSpecification} MapboxStyle */
/** @typedef {import('@mapbox/mapbox-gl-style-spec').LightsSpecification} MapboxLightsSpec */
/** @typedef {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} MaplibreStyle */
/** @typedef {import('@maplibre/maplibre-gl-style-spec').LightSpecification} MaplibreLightSpec */
/** @typedef {import('@maplibre/maplibre-gl-style-spec').SkySpecification} MaplibreSkySpec */

import { migrate, derefLayers } from "@maplibre/maplibre-gl-style-spec";
import { transformSources } from "./sources.js";
import { transformLayers } from "./layers.js";
import { transformLight } from "./light.js";
import { transformExpression } from "./expressions.js";
import { transformUrls } from "./urls.js";

/** Root properties supported by MapLibre */
const MAPLIBRE_ROOT_PROPERTIES = new Set([
  "version",
  "name",
  "metadata",
  "center",
  "zoom",
  "bearing",
  "pitch",
  "light",
  "sky",
  "terrain",
  "projection",
  "sources",
  "sprite",
  "glyphs",
  "transition",
  "layers",
]);

/**
 * Mapbox projection names mapped to MapLibre equivalents.
 * Unsupported projections fall back to "mercator".
 * Mapbox "globe" maps to MapLibre "vertical-perspective".
 * @type {Record<string, string>}
 */
const PROJECTION_MAP = {
  mercator: "mercator",
  globe: "vertical-perspective",
};

/**
 * Transform a Mapbox GL style into a MapLibre GL compatible style.
 *
 * @param {MapboxStyle} style - A Mapbox GL style object
 * @param {{ accessToken?: string }} [options]
 * @returns {MaplibreStyle} A new MapLibre GL compatible style object
 */
export function mapboxToMaplibre(style, options) {
  /** @type {MaplibreStyle} */
  const result = {
    version: 8,
    sources: {},
    layers: [],
  };

  // Transform mapbox:// URLs to https://api.mapbox.com/ URLs (mutates)
  transformUrls(style, options);

  // Copy supported root properties
  for (const key of Object.keys(style)) {
    if (MAPLIBRE_ROOT_PROPERTIES.has(key)) {
      // @ts-ignore — Object.keys() returns string[], not the union of known keys,
      // so TS can't verify the key is valid on both types. Guarded by MAPLIBRE_ROOT_PROPERTIES.
      result[key] = style[key];
    }
  }

  // Ensure version is 8
  result.version = 8;

  // Transform sources — remove unsupported source types
  if (style.sources) {
    result.sources = transformSources(style.sources);
  }

  // Transform layers:
  // 1. derefLayers resolves deprecated `ref` layers by inlining inherited properties
  // 2. transformLayers strips Mapbox-only properties and converts layer types
  if (style.layers) {
    // Mapbox LayerSpecification includes types not in MapLibre's LayerWithRef (e.g. Building,
    // Slot, Clip). derefLayers only resolves `ref` properties and passes unknown types through.
    const derefed = derefLayers(/** @type {any} */ (style.layers));
    // derefed is MapLibre-typed but the data contains Mapbox layer types;
    // transformLayers expects Mapbox layers and filters unsupported types.
    result.layers = transformLayers(/** @type {any} */ (derefed));
  }

  // Transform light
  if (style.light) {
    result.light = transformLight(style.light);
  }

  // Convert Mapbox `lights` array to single MapLibre `light` (if no `light` already)
  if (!style.light && Array.isArray(style.lights)) {
    const converted = convertLightsToLight(style.lights);
    if (converted) {
      result.light = converted;
    }
  }

  // Transform projection
  if (style.projection) {
    result.projection = transformProjection(style.projection);
  }

  // Transform terrain — structure is compatible, just pass through
  // (both specs use { source, exaggeration })

  // Convert Mapbox `fog` to MapLibre `sky` if no sky layer exists
  if (style.fog && !result.sky) {
    const sky = convertFogToSky(style.fog);
    if (sky) {
      result.sky = sky;
    }
  }

  // Run MapLibre's migrate() to convert legacy filters/functions to expressions
  // and normalize HSL color formats
  return migrate(result);
}

/**
 * Convert Mapbox `lights` array to a single MapLibre `light` object.
 * Extracts the directional light if present.
 *
 * @param {MapboxLightsSpec[]} lights
 * @returns {MaplibreLightSpec | null}
 */
function convertLightsToLight(lights) {
  const directional = lights.find((l) => l.type === "directional");
  if (
    directional &&
    typeof directional.properties === "object" &&
    directional.properties
  ) {
    const props = directional.properties;
    /** @type {MaplibreLightSpec} */
    const light = {};
    // Mapbox and MapLibre PropertyValueSpecification<T> are structurally identical
    // (T | CameraFunction<T> | Expression), but their ExpressionSpecification types
    // differ nominally — Mapbox uses [string, ...any[]], MapLibre uses a specific
    // tuple union. Casts bridge this nominal mismatch; values are compatible at runtime.
    if ("color" in props && props.color !== undefined)
      light.color = /** @type {MaplibreLightSpec['color']} */ (props.color);
    if ("intensity" in props && props.intensity !== undefined)
      light.intensity = /** @type {MaplibreLightSpec['intensity']} */ (
        props.intensity
      );
    // Mapbox directional light has direction [azimuth, polar], MapLibre light has position [radial, azimuth, polar]
    if (
      "direction" in props &&
      Array.isArray(props.direction) &&
      props.direction.length >= 2
    ) {
      light.position = [
        1.15,
        Number(props.direction[0]),
        Number(props.direction[1]),
      ];
    }
    return light;
  }

  // Fallback: try ambient light for color/intensity
  const ambient = lights.find((l) => l.type === "ambient");
  if (ambient && typeof ambient.properties === "object" && ambient.properties) {
    const props = ambient.properties;
    /** @type {MaplibreLightSpec} */
    const light = {};
    // Same cross-library ExpressionSpecification mismatch as above
    if ("color" in props && props.color !== undefined)
      light.color = /** @type {MaplibreLightSpec['color']} */ (props.color);
    if ("intensity" in props && props.intensity !== undefined)
      light.intensity = /** @type {MaplibreLightSpec['intensity']} */ (
        props.intensity
      );
    return light;
  }

  return null;
}

/**
 * Transform projection to MapLibre-compatible format.
 *
 * Mapbox ProjectionSpecification is always an object with a required `name` property
 * and optional `center`/`parallels`. MapLibre uses `type` instead of `name`.
 *
 * @param {NonNullable<MapboxStyle['projection']>} projection
 * @returns {MaplibreStyle['projection']}
 */
function transformProjection(projection) {
  const { name, ...rest } = projection;
  const type = PROJECTION_MAP[name] ?? "mercator";
  // MapLibre ProjectionSpecification.type is PropertyValueSpecification<ProjectionDefinitionSpecification>,
  // a complex nested type. Plain string literals like "mercator" satisfy it at runtime but TS can't verify
  // the match through the intermediate types, so we cast the whole object.
  return /** @type {MaplibreStyle['projection']} */ ({ ...rest, type });
}

/**
 * Convert Mapbox `fog` to MapLibre `sky` properties.
 * Best-effort mapping of atmospheric effects.
 *
 * @param {NonNullable<MapboxStyle['fog']>} fog
 * @returns {MaplibreSkySpec | null}
 */
function convertFogToSky(fog) {
  /** @type {MaplibreSkySpec} */
  const sky = {};
  // Cross-library ExpressionSpecification mismatch: Mapbox and MapLibre
  // PropertyValueSpecification<T> are structurally identical but nominally
  // incompatible. Cast to the specific MapLibre property types.
  if (fog.color !== undefined)
    sky["fog-color"] = /** @type {MaplibreSkySpec['fog-color']} */ (fog.color);
  if (fog["high-color"] !== undefined)
    sky["sky-color"] = /** @type {MaplibreSkySpec['sky-color']} */ (
      fog["high-color"]
    );
  if (fog["horizon-blend"] !== undefined)
    sky["sky-horizon-blend"] =
      /** @type {MaplibreSkySpec['sky-horizon-blend']} */
      (fog["horizon-blend"]);
  if (Object.keys(sky).length === 0) return null;
  return sky;
}

export { transformExpression };
