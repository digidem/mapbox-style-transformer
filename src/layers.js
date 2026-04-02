/**
 * Transform Mapbox layers to MapLibre-compatible layers.
 *
 * - Removes unsupported layer types (model, raster-particle, slot, clip)
 * - Converts `sky` layers to simplified fill/background or removes them
 * - Converts `building` layers to `fill-extrusion`
 * - Strips Mapbox-only paint/layout properties from shared layer types
 */

/** @typedef {import('@maplibre/maplibre-gl-style-spec').LayerSpecification} MaplibreLayer */

/** @typedef {'fill' | 'line' | 'symbol' | 'circle' | 'heatmap' | 'fill-extrusion' | 'raster' | 'hillshade' | 'background'} SupportedLayerType */
/** @typedef {import("./index.js").MapboxStyle['layers'][number]} LayerInput */

import { transformExpression, transformHslColorString } from "./expressions.js";

/**
 * Layer types that MapLibre supports.
 */
/** @type {Set<string>} */
const SUPPORTED_LAYER_TYPES = new Set([
  "fill",
  "line",
  "symbol",
  "circle",
  "heatmap",
  "fill-extrusion",
  "raster",
  "hillshade",
  "background",
]);

/**
 * @param {string} type
 * @returns {type is SupportedLayerType}
 */
function isSupportedLayerType(type) {
  return SUPPORTED_LAYER_TYPES.has(type);
}

/**
 * Mapbox-only paint properties per layer type.
 * These will be stripped during transformation.
 * @type {Record<SupportedLayerType, Set<string>>}
 */
const UNSUPPORTED_PAINT = {
  fill: new Set([
    "fill-bridge-guard-rail-color",
    "fill-emissive-strength",
    "fill-pattern-cross-fade",
    "fill-tunnel-structure-color",
    "fill-z-offset",
  ]),
  line: new Set([
    "line-blend-mode",
    "line-border-color",
    "line-border-width",
    "line-emissive-strength",
    "line-occlusion-opacity",
    "line-pattern-cross-fade",
    "line-trim-color",
    "line-trim-fade-range",
    "line-trim-offset",
  ]),
  symbol: new Set([
    "icon-color-brightness-max",
    "icon-color-brightness-min",
    "icon-color-contrast",
    "icon-color-saturation",
    "icon-emissive-strength",
    "icon-image-cross-fade",
    "icon-occlusion-opacity",
    "symbol-z-offset",
    "text-emissive-strength",
    "text-occlusion-opacity",
  ]),
  circle: new Set(["circle-emissive-strength"]),
  "fill-extrusion": new Set([
    "fill-extrusion-ambient-occlusion-ground-attenuation",
    "fill-extrusion-ambient-occlusion-ground-radius",
    "fill-extrusion-ambient-occlusion-intensity",
    "fill-extrusion-ambient-occlusion-radius",
    "fill-extrusion-ambient-occlusion-wall-radius",
    "fill-extrusion-base-alignment",
    "fill-extrusion-cast-shadows",
    "fill-extrusion-cutoff-fade-range",
    "fill-extrusion-emissive-strength",
    "fill-extrusion-flood-light-color",
    "fill-extrusion-flood-light-ground-attenuation",
    "fill-extrusion-flood-light-ground-radius",
    "fill-extrusion-flood-light-intensity",
    "fill-extrusion-flood-light-wall-radius",
    "fill-extrusion-front-cutoff",
    "fill-extrusion-height-alignment",
    "fill-extrusion-line-width",
    "fill-extrusion-pattern-cross-fade",
    "fill-extrusion-rounded-roof",
    "fill-extrusion-vertical-scale",
  ]),
  raster: new Set([
    "raster-array-band",
    "raster-color",
    "raster-color-mix",
    "raster-color-range",
    "raster-elevation",
    "raster-elevation-reference",
    "raster-emissive-strength",
  ]),
  hillshade: new Set(["hillshade-emissive-strength"]),
  background: new Set([
    "background-emissive-strength",
    "background-pitch-alignment",
  ]),
  heatmap: new Set(),
};

/**
 * Mapbox-only layout properties per layer type.
 * @type {Record<SupportedLayerType, Set<string>>}
 */
const UNSUPPORTED_LAYOUT = {
  fill: new Set([
    "fill-construct-bridge-guard-rail",
    "fill-elevation-reference",
  ]),
  line: new Set([
    "line-cross-slope",
    "line-elevation-ground-scale",
    "line-elevation-reference",
    "line-width-unit",
    "line-z-offset",
  ]),
  symbol: new Set([
    "icon-size-scale-range",
    "symbol-elevation-reference",
    "symbol-z-elevate",
    "text-size-scale-range",
  ]),
  circle: new Set(["circle-elevation-reference"]),
  "fill-extrusion": new Set(["fill-extrusion-edge-radius", "source-max-zoom"]),
  raster: new Set(),
  hillshade: new Set(),
  background: new Set(),
  heatmap: new Set(),
};

/** Base layer properties supported by MapLibre */
const SUPPORTED_LAYER_BASE_PROPERTIES = new Set([
  "id",
  "type",
  "source",
  "source-layer",
  "filter",
  "layout",
  "paint",
  "metadata",
  "minzoom",
  "maxzoom",
]);

/**
 * Transform an array of Mapbox layers to MapLibre-compatible layers.
 * Expects layers to already be dereferenced (no `ref` properties).
 *
 * @param {LayerInput[]} layers
 * @returns {MaplibreLayer[]}
 */
export function transformLayers(layers) {
  /** @type {MaplibreLayer[]} */
  const result = [];

  for (const layer of layers) {
    const transformed = transformLayer(layer);
    if (transformed) {
      result.push(transformed);
    }
  }

  return result;
}

/**
 * Transform a single layer.
 *
 * @param {LayerInput} layer
 * @returns {MaplibreLayer | null}
 */
function transformLayer(layer) {
  const { type } = layer;

  // Convert building layers to fill-extrusion
  if (layer.type === "building") {
    return transformBuildingLayer(layer);
  }

  // Sky layers are Mapbox-only (MapLibre uses root `sky` property)
  // Remove them — the root-level fog→sky conversion handles atmosphere
  if (type === "sky") {
    return null;
  }

  // Remove unsupported layer types entirely
  if (!isSupportedLayerType(type)) {
    return null;
  }

  /** @type {Record<string, unknown>} */
  const result = {};

  // Copy supported base properties
  for (const [key, value] of Object.entries(layer)) {
    if (SUPPORTED_LAYER_BASE_PROPERTIES.has(key)) {
      result[key] = value;
    }
  }

  // Transform filter expressions
  if (result.filter) {
    result.filter = transformExpression(result.filter);
  }

  // Transform paint properties
  if (layer.paint) {
    result.paint = transformProperties(layer.paint, UNSUPPORTED_PAINT[type]);
  }

  // Transform layout properties
  if (layer.layout) {
    result.layout = transformProperties(layer.layout, UNSUPPORTED_LAYOUT[type]);
  }

  return /** @type {MaplibreLayer} */ (result);
}

/**
 * Convert a Mapbox `building` layer to a `fill-extrusion` layer.
 * Maps building-* properties to fill-extrusion-* equivalents.
 *
 * @param {import("@mapbox/mapbox-gl-style-spec").BuildingLayerSpecification} layer
 * @returns {MaplibreLayer}
 */
function transformBuildingLayer(layer) {
  /** @type {Record<string, unknown>} */
  const result = {};

  for (const [key, value] of Object.entries(layer)) {
    if (SUPPORTED_LAYER_BASE_PROPERTIES.has(key)) {
      result[key] = value;
    }
  }

  result.type = "fill-extrusion";

  const { paint, layout } = layer;

  // Mapbox building properties come from both paint and layout:
  //   paint:  building-color, building-opacity
  //   layout: building-height, building-base
  // All map to fill-extrusion paint properties in MapLibre.
  /** @type {Record<string, unknown>} */
  const newPaint = {};
  /** @type {Record<string, [string, Record<string, unknown> | undefined]>} */
  const paintMapping = {
    "building-color": ["fill-extrusion-color", paint],
    "building-opacity": ["fill-extrusion-opacity", paint],
    "building-height": ["fill-extrusion-height", layout],
    "building-base": ["fill-extrusion-base", layout],
  };
  for (const [bKey, [feKey, source]] of Object.entries(paintMapping)) {
    if (source && source[bKey] !== undefined) {
      newPaint[feKey] = transformExpression(source[bKey]);
    }
  }
  result.paint = newPaint;

  // Only carry over visibility from layout
  if (layout && layout.visibility !== undefined) {
    result.layout = { visibility: layout.visibility };
  }

  return /** @type {MaplibreLayer} */ (result);
}

/**
 * Transform paint/layout properties: strip unsupported ones, transform expressions in values.
 *
 * @param {Record<string, unknown>} properties
 * @param {Set<string>} unsupported
 * @returns {Record<string, unknown>}
 */
function transformProperties(properties, unsupported) {
  /** @type {Record<string, unknown>} */
  const result = {};

  for (const [key, value] of Object.entries(properties)) {
    if (unsupported.has(key)) {
      continue;
    }
    result[key] = transformPropertyValue(value);
  }

  return result;
}

/**
 * Transform a property value, which may be a literal, expression, or legacy function.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function transformPropertyValue(value) {
  // Convert HSL/HSLA color strings to RGB — MapLibre doesn't support hsl() in property values
  if (typeof value === "string") {
    return transformHslColorString(value);
  }

  if (Array.isArray(value)) {
    return transformExpression(value);
  }

  // Legacy function stops (zoom functions with { stops, type, ... })
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    if (Array.isArray(obj.stops)) {
      return {
        ...obj,
        stops: obj.stops.map((/** @type {unknown[]} */ stop) => [
          stop[0],
          transformPropertyValue(stop[1]),
        ]),
      };
    }
    // Could be a property spec with default — recurse
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = transformPropertyValue(v);
    }
    return result;
  }

  return value;
}
