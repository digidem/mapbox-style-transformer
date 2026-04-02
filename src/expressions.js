/**
 * Transform Mapbox expressions to MapLibre-compatible expressions.
 *
 * Removes or replaces Mapbox-only expression operators:
 * - config, measure-light, raster-value, raster-particle-speed,
 *   sky-radial-progress, is-active-floor, at-interpolated, pitch,
 *   random, worldview, hsl, hsla, to-hsla, distance-from-center
 */

/** @typedef {import('@mapbox/mapbox-gl-style-spec').ExpressionSpecification} MapboxExpression */

/** Mapbox-only expression operators that have no MapLibre equivalent */
const UNSUPPORTED_EXPRESSIONS = new Set([
  "config",
  "measure-light",
  "raster-value",
  "raster-particle-speed",
  "sky-radial-progress",
  "is-active-floor",
  "distance-from-center",
  "worldview",
]);

/**
 * Recursively transform an expression (or property value that may contain expressions).
 *
 * Returns the transformed value, or null if the expression should be removed entirely.
 *
 * @param {unknown} expr
 * @returns {unknown}
 */
export function transformExpression(expr) {
  // Convert HSL color strings embedded in expressions
  if (typeof expr === "string") {
    return transformHslColorString(expr);
  }

  if (!Array.isArray(expr)) {
    return expr;
  }

  const op = expr[0];

  if (typeof op !== "string") {
    // Array literal — recurse into elements
    return expr.map(transformExpression);
  }

  // hsl/hsla → rgb/rgba conversion
  if (op === "hsl" || op === "hsla") {
    return transformHslExpression(expr);
  }

  // to-hsla → to-rgba (closest equivalent)
  if (op === "to-hsla") {
    return ["to-rgba", ...expr.slice(1).map(transformExpression)];
  }

  // pitch → use literal 0 as fallback (no equivalent in MapLibre expressions)
  if (op === "pitch") {
    return 0;
  }

  // random → use literal 0.5 as fallback
  if (op === "random") {
    return 0.5;
  }

  // Unsupported expressions that appear in boolean/conditional context
  if (UNSUPPORTED_EXPRESSIONS.has(op)) {
    return null;
  }

  // For case/match/coalesce — clean up branches that reference unsupported expressions
  if (op === "case") {
    return transformCase(expr);
  }

  if (op === "match") {
    return transformMatch(expr);
  }

  if (op === "coalesce") {
    return transformCoalesce(expr);
  }

  // at-interpolated → at (closest equivalent, just drops interpolation)
  if (op === "at-interpolated") {
    return ["at", ...expr.slice(1).map(transformExpression)];
  }

  // Recurse into all sub-expressions
  return expr.map(transformExpression);
}

/**
 * Transform a `case` expression, removing branches with unsupported conditions.
 *
 * @param {unknown[]} expr - ["case", cond1, val1, cond2, val2, ..., fallback]
 * @returns {unknown}
 */
function transformCase(expr) {
  /** @type {unknown[]} */
  const result = ["case"];
  // Process condition/value pairs
  for (let i = 1; i < expr.length - 1; i += 2) {
    const condition = transformExpression(expr[i]);
    const value = transformExpression(expr[i + 1]);
    if (condition === null) {
      // Skip this branch — condition uses unsupported expression
      continue;
    }
    result.push(condition, value);
  }
  // Fallback value (last element)
  const fallback = transformExpression(expr[expr.length - 1]);
  if (result.length === 1) {
    // All branches removed — just return the fallback
    return fallback;
  }
  result.push(fallback);
  return result;
}

/**
 * Transform a `match` expression, removing branches with null outputs.
 *
 * @param {unknown[]} expr - ["match", input, label1, output1, label2, output2, ..., fallback]
 * @returns {unknown}
 */
function transformMatch(expr) {
  const input = transformExpression(expr[1]);
  if (input === null) return transformExpression(expr[expr.length - 1]);

  /** @type {unknown[]} */
  const result = ["match", input];
  for (let i = 2; i < expr.length - 1; i += 2) {
    const label = expr[i];
    const output = transformExpression(expr[i + 1]);
    if (output === null) continue;
    result.push(label, output);
  }
  const fallback = transformExpression(expr[expr.length - 1]);
  if (result.length === 2) return fallback;
  result.push(fallback);
  return result;
}

/**
 * Transform a `coalesce` expression, removing null branches.
 *
 * @param {unknown[]} expr - ["coalesce", expr1, expr2, ...]
 * @returns {unknown}
 */
function transformCoalesce(expr) {
  const args = expr
    .slice(1)
    .map(transformExpression)
    .filter((v) => v !== null);
  if (args.length === 0) return null;
  if (args.length === 1) return args[0];
  return ["coalesce", ...args];
}

/**
 * Convert HSL expression to RGB.
 * If all args are literals, convert inline. Otherwise fall back to rgb expression.
 *
 * @param {unknown[]} expr - ["hsl", h, s, l] or ["hsla", h, s, l, a]
 * @returns {unknown}
 */
function transformHslExpression(expr) {
  const isHsla = expr[0] === "hsla";
  const args = expr.slice(1).map(transformExpression);

  // If all arguments are numeric literals, convert to rgb/rgba inline
  if (args.every((a) => typeof a === "number")) {
    const nums = /** @type {number[]} */ (args);
    const [r, g, b] = hslToRgb(nums[0], nums[1] / 100, nums[2] / 100);
    if (isHsla && nums.length >= 4) {
      return ["rgba", r, g, b, nums[3]];
    }
    return ["rgb", r, g, b];
  }

  // Dynamic args — can't convert, use rgb with the values as-is
  // This is lossy but keeps the expression functional
  if (isHsla) {
    return ["rgba", ...args];
  }
  return ["rgb", ...args.slice(0, 3)];
}

/**
 * Convert CSS hsl()/hsla() color strings to rgb()/rgba().
 * MapLibre does not support hsl() in property values.
 *
 * @param {string} value
 * @returns {string}
 */
export function transformHslColorString(value) {
  return value.replace(
    /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?(?:\s*,\s*([\d.]+))?\s*\)/gi,
    (_, h, s, l, a) => {
      const [r, g, b] = hslToRgb(Number(h), Number(s) / 100, Number(l) / 100);
      if (a !== undefined) {
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      }
      return `rgb(${r}, ${g}, ${b})`;
    },
  );
}

/**
 * Convert HSL to RGB values.
 *
 * @param {number} h - Hue in degrees (0-360)
 * @param {number} s - Saturation (0-1)
 * @param {number} l - Lightness (0-1)
 * @returns {[number, number, number]} RGB values (0-255)
 */
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}
