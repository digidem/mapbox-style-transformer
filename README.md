# mapbox-style-transformer

Transforms [Mapbox GL](https://docs.mapbox.com/style-spec/) style documents into
[MapLibre GL](https://maplibre.org/maplibre-style-spec/) compatible styles.
Handles proprietary extensions, unsupported layer types, Mapbox-only properties,
expression operators, and `mapbox://` URLs.

## Usage

```js
import { mapboxToMaplibre, isMapboxStyle } from "mapbox-style-transformer";

const maplibreStyle = mapboxToMaplibre(mapboxStyle);

// With a Mapbox access token (appended to transformed URLs):
const maplibreStyle = mapboxToMaplibre(mapboxStyle, {
  accessToken: "pk.your_token_here",
});
```

`mapboxToMaplibre` returns a new style object; the input is not mutated.

### `isMapboxStyle(style)`

A type guard that returns `true` if the style appears to be a Mapbox GL style.
Detects `mapbox://` protocol URLs in `glyphs`, `sprite`, or source `url`
properties, and Mapbox-only root properties (`fog`, `lights`, `imports`, etc.).

```js
if (isMapboxStyle(style)) {
  // style is narrowed to MapboxStyle
  style = mapboxToMaplibre(style);
}
```

This is a heuristic — it catches most Mapbox styles but may not detect styles
that use no `mapbox://` URLs and no Mapbox-only properties.

## What gets transformed

### URLs

`mapbox://` protocol URIs are converted to standard HTTPS URLs:

| Resource | Input                                           | Output                                                           |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Source   | `mapbox://mapbox.mapbox-streets-v8`             | `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8.json`        |
| Glyphs   | `mapbox://fonts/mapbox/{fontstack}/{range}.pbf` | `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf` |
| Sprite   | `mapbox://sprites/mapbox/streets-v12`           | `https://api.mapbox.com/styles/v1/mapbox/streets-v12/sprite`     |

If an `accessToken` is provided, `?access_token=<token>` is appended to each
transformed URL. Non-`mapbox://` URLs are left unchanged.

### Root properties

Mapbox-only root properties are removed: `fog`, `lights`, `snow`, `rain`,
`camera`, `color-theme`, `imports`, `schema`, `models`, `featuresets`,
`fragment`, `indoor`, `iconsets`.

`fog` is converted to MapLibre's `sky` property where possible (see below).

### Sources

Unsupported source types are removed entirely:

- `raster-array`
- `model`

### Layer types

| Mapbox type                                                                                          | Action                                 |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `fill`, `line`, `symbol`, `circle`, `heatmap`, `fill-extrusion`, `raster`, `hillshade`, `background` | Kept (Mapbox-only properties stripped) |
| `building`                                                                                           | Converted to `fill-extrusion`          |
| `model`, `raster-particle`, `slot`, `clip`, `sky`                                                    | Removed                                |

#### Building layer conversion

Mapbox `building` layers become `fill-extrusion` layers with property mapping:

| Mapbox (paint)     | MapLibre (paint)         |
| ------------------ | ------------------------ |
| `building-color`   | `fill-extrusion-color`   |
| `building-opacity` | `fill-extrusion-opacity` |

| Mapbox (layout)   | MapLibre (paint)        |
| ----------------- | ----------------------- |
| `building-height` | `fill-extrusion-height` |
| `building-base`   | `fill-extrusion-base`   |

Building-only properties like `building-emissive-strength`,
`building-roof-shape`, `building-facade` are dropped.

### Paint and layout properties

Mapbox-only properties are stripped from each layer type. These include emissive
strength, occlusion opacity, z-offset, border, flood-light, and other properties
not supported by MapLibre. See [src/layers.js](src/layers.js) for the full list
per layer type.

Unsupported base layer properties (`slot`, `appearance`) are also removed.

### Projection

| Mapbox        | MapLibre              |
| ------------- | --------------------- |
| `mercator`    | `mercator`            |
| `globe`       | `globe`               |
| Anything else | `mercator` (fallback) |

The Mapbox `name` property is replaced with `type` and Mapbox-only properties
(like `center`, `parallels` for Albers) are removed.

### Light

The `light` property (shared by both specs) is passed through, keeping only
`anchor`, `position`, `color`, and `intensity`.

If the style has a Mapbox `lights` array (the newer multi-light system) but no
`light` property, the directional light is extracted and converted to a single
MapLibre `light` object. The directional light's `direction` [azimuth, polar] is
mapped to MapLibre's `position` [1.15, azimuth, polar].

### Fog to sky

Mapbox `fog` properties are mapped to MapLibre `sky`:

| Mapbox fog      | MapLibre sky        |
| --------------- | ------------------- |
| `color`         | `fog-color`         |
| `high-color`    | `sky-color`         |
| `horizon-blend` | `sky-horizon-blend` |

Other fog properties (`range`, `star-intensity`, `vertical-range`,
`space-color`) have no MapLibre equivalent and are dropped.

If the style already has a `sky` property, `fog` conversion is skipped.

### Expressions

Mapbox-only expression operators are handled:

| Expression                                                                                                                                        | Action                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `hsl`, `hsla`                                                                                                                                     | Converted to `rgb`/`rgba` (literal args converted inline, dynamic args passed through) |
| `to-hsla`                                                                                                                                         | Converted to `to-rgba`                                                                 |
| `at-interpolated`                                                                                                                                 | Converted to `at`                                                                      |
| `pitch`                                                                                                                                           | Replaced with literal `0`                                                              |
| `random`                                                                                                                                          | Replaced with literal `0.5`                                                            |
| `config`, `measure-light`, `raster-value`, `raster-particle-speed`, `sky-radial-progress`, `is-active-floor`, `distance-from-center`, `worldview` | Removed (returns `null`)                                                               |

HSL color strings (e.g. `"hsl(200, 50%, 60%)"`) in property values are converted
to RGB.

`case`, `match`, and `coalesce` expressions are cleaned up: branches that
reference unsupported expressions are removed, and if all branches are removed,
the fallback value is returned directly.

### Legacy style features

After all transformations, MapLibre's `migrate()` function runs to convert any
remaining legacy features:

- Old-style filters to expressions
- Property functions with `stops` to interpolation expressions
- Token strings like `"{name}"` to `["to-string", ["get", "name"]]`

## Visual impact

The goal is to preserve visual appearance where possible, but some differences
are unavoidable:

- **3D models removed**: `model` layers and sources are dropped entirely.
- **Atmosphere simplified**: The multi-property Mapbox `fog` maps to a simpler
  MapLibre `sky` with fewer controls.
- **Multi-light to single light**: The Mapbox `lights` array (ambient +
  directional) collapses to a single directional light.
- **Building layers**: Mapbox's procedural building rendering features (facade
  details, roof shapes, flood lighting) are lost; only the basic extrusion
  geometry is preserved.
- **Particle effects removed**: `raster-particle` layers (e.g., wind
  visualization) are dropped.
- **Sky layers removed**: Mapbox `sky` layers are dropped (MapLibre uses a root
  `sky` property instead).
- **Emissive/occlusion effects lost**: All emissive strength and occlusion
  opacity properties are stripped.
- **Expressions with no equivalent**: `pitch` becomes `0`, `random` becomes
  `0.5`, `config` values are removed. Styles that relied on these for dynamic
  behavior will show static fallback values.
