/**
 * Transform light object. Both specs share the same light structure
 * (anchor, position, color, intensity) so this is mostly a pass-through.
 */

/** @typedef {import('@mapbox/mapbox-gl-style-spec').LightSpecification} MapboxLightSpec */
/** @typedef {import('@maplibre/maplibre-gl-style-spec').LightSpecification} MaplibreLightSpec */

const SUPPORTED_LIGHT_PROPERTIES = new Set([
  "anchor",
  "position",
  "color",
  "intensity",
]);

/**
 * @param {MapboxLightSpec} light
 * @returns {MaplibreLightSpec}
 */
export function transformLight(light) {
  /** @type {Partial<MaplibreLightSpec>} */
  const result = {};
  for (const [key, value] of Object.entries(light)) {
    if (SUPPORTED_LIGHT_PROPERTIES.has(key)) {
      // @ts-ignore — copying compatible properties dynamically
      result[key] = value;
    }
  }
  return /** @type {MaplibreLightSpec} */ (result);
}
