/**
 * Transform Mapbox sources to MapLibre-compatible sources.
 * Removes unsupported source types (raster-array, model).
 */

/** @typedef {import('@mapbox/mapbox-gl-style-spec').SourcesSpecification} MapboxSources */
/** @typedef {import('@mapbox/mapbox-gl-style-spec').SourceSpecification} MapboxSource */
/** @typedef {import('@maplibre/maplibre-gl-style-spec').SourceSpecification} MaplibreSource */

/** Source types supported by MapLibre */
const SUPPORTED_SOURCE_TYPES = new Set([
  "vector",
  "raster",
  "raster-dem",
  "geojson",
  "image",
  "video",
]);

/** Properties on sources not supported by MapLibre */
const UNSUPPORTED_SOURCE_PROPERTIES = new Set(["dynamicness"]);

/**
 * @param {MapboxSources} sources
 * @returns {Record<string, MaplibreSource>}
 */
export function transformSources(sources) {
  /** @type {Record<string, MaplibreSource>} */
  const result = {};

  for (const [id, source] of Object.entries(sources)) {
    if (!SUPPORTED_SOURCE_TYPES.has(source.type)) {
      continue;
    }

    /** @type {Record<string, unknown>} */
    const transformed = {};
    for (const [key, value] of Object.entries(source)) {
      if (!UNSUPPORTED_SOURCE_PROPERTIES.has(key)) {
        transformed[key] = value;
      }
    }

    result[id] = /** @type {MaplibreSource} */ (transformed);
  }

  return result;
}
