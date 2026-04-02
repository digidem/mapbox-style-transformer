/**
 * Transform mapbox:// protocol URIs to standard https://api.mapbox.com/ URLs.
 * MapLibre does not understand the proprietary mapbox:// protocol.
 */

const BASE_MAPBOX_API_URL = "https://api.mapbox.com";

/**
 * @param {string} url
 * @returns {boolean}
 */
function isMapboxURI(url) {
  try {
    return new URL(url).protocol === "mapbox:";
  } catch {
    return false;
  }
}

/**
 * Transform a mapbox://fonts/ URI to an https://api.mapbox.com/fonts/v1/ URL.
 *
 * @param {string} uri - e.g. "mapbox://fonts/mapbox/{fontstack}/{range}.pbf"
 * @param {string} [accessToken]
 * @returns {string}
 */
function transformGlyphsUrl(uri, accessToken) {
  const u = new URL(uri);
  if (u.host !== "fonts") {
    throw new Error(`Expected URL for font resource. Received ${u.host}`);
  }
  const result = new URL(`fonts/v1${u.pathname}`, BASE_MAPBOX_API_URL);
  if (accessToken) {
    result.searchParams.set("access_token", accessToken);
  }
  // Preserve {fontstack}/{range} template placeholders that URL encoding would break
  return decodeURI(result.href);
}

/**
 * Transform a mapbox://sprites/ URI to an https://api.mapbox.com/styles/v1/.../sprite URL.
 *
 * @param {string} uri - e.g. "mapbox://sprites/mapbox/streets-v12"
 * @param {string} [accessToken]
 * @returns {string}
 */
function transformSpriteUrl(uri, accessToken) {
  const u = new URL(uri);
  if (u.host !== "sprites") {
    throw new Error(`Expected URL for sprite resource. Received ${u.host}`);
  }
  const result = new URL(`styles/v1${u.pathname}/sprite`, BASE_MAPBOX_API_URL);
  if (accessToken) {
    result.searchParams.set("access_token", accessToken);
  }
  return decodeURI(result.href);
}

/**
 * Transform a mapbox:// source URI to an https://api.mapbox.com/v4/ TileJSON URL.
 *
 * @param {string} uri - e.g. "mapbox://mapbox.mapbox-streets-v8"
 * @param {string} [accessToken]
 * @returns {string}
 */
function transformSourceUrl(uri, accessToken) {
  const u = new URL(uri);
  const tilesetId = u.host;
  const result = new URL(`v4/${tilesetId}.json`, BASE_MAPBOX_API_URL);
  if (accessToken) {
    result.searchParams.set("access_token", accessToken);
  }
  return result.href;
}

/**
 * Transform all mapbox:// URLs in a style object.
 * Handles glyphs, sprite (string or array), and source URLs.
 *
 * @param {import("./index.js").MapboxStyle} style
 * @param {{ accessToken?: string }} [options]
 */
export function transformUrls(style, options) {
  const token = options?.accessToken;

  // Transform glyphs
  if (typeof style.glyphs === "string" && isMapboxURI(style.glyphs)) {
    style.glyphs = transformGlyphsUrl(style.glyphs, token);
  }

  // Transform sprite — can be a string or array of { id, url }
  if (typeof style.sprite === "string" && isMapboxURI(style.sprite)) {
    style.sprite = transformSpriteUrl(style.sprite, token);
  }

  // Transform source URLs
  if (style.sources) {
    for (const sourceId of Object.keys(style.sources)) {
      const source = style.sources[sourceId];
      if (
        "url" in source &&
        typeof source.url === "string" &&
        isMapboxURI(source.url)
      ) {
        source.url = transformSourceUrl(source.url, token);
      }
    }
  }
}
