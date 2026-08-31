# Cosmic Motion — Scientific & Engineering Principles

This document establishes the foundational rules for all code in this project.
Every coordinate transform, scale factor, and position calculation must trace
back to these principles. When in doubt, choose accuracy over aesthetics.

## 1. Coordinate Origin

**The Sun is at (0, 0, 0).** All positions in the scene are heliocentric.
Earth, planets, moons — everything is positioned using its absolute
heliocentric ecliptic coordinates, never as offsets from another body.

## 2. Coordinate System

All astronomical computation uses **heliocentric ecliptic J2000** coordinates:
- X: toward vernal equinox
- Y: in the ecliptic plane, 90° east
- Z: toward ecliptic north pole

Conversion to Three.js scene coordinates via `eclToThree`:
- Ecliptic X → Three.js X
- Ecliptic Y → Three.js -Z
- Ecliptic Z → Three.js Y (up)

## 3. Unified Scale

One AU-to-scene conversion factor for the entire application:

```
AU_SCENE = 50    // 1 AU = 50 scene units
```

All positions: `eclToThree(helioPos_AU) * AU_SCENE`

There are no separate trajectory scales, no per-feature multipliers.
If something needs to appear larger, use mesh/sprite scale — never a
different coordinate scale.

## 4. Body Sizes — Perspective-Faithful Scaling

Bodies render at the angular size a human observer would perceive from the
camera's position. Mesh geometries use fixed "base radii" (for texture detail),
and a per-frame scale factor adjusts each body's apparent size.

### True proportional radii

Every body has a true scene radius derived from real physics:

```
trueSceneRadius = radiusKm / AU_KM * AU_SCENE
```

| Body    | True scene radius |
|---------|-------------------|
| Sun     | 0.2326            |
| Jupiter | 0.02337           |
| Saturn  | 0.01946           |
| Earth   | 0.00213           |
| Moon    | 0.000581          |

### Per-frame scaling

Each frame, for every body:
1. Compute camera distance to the body.
2. Compute true angular radius: `trueR / cameraDist`.
3. Enforce a minimum angular size (MIN_BODY_PX = 3 pixels) so distant bodies
   remain visible.
4. Set `mesh.scale` = `effectiveRadius / meshBaseRadius`.

Close up, bodies show at their real proportional size — the Sun is massive,
Jupiter dwarfs Earth. Far away, bodies shrink to minimum-size dots on their
orbital paths.

### Mesh base radii (geometry construction sizes)

These are the radii used when creating SphereGeometry. They don't represent
the displayed size; the per-frame scale factor does.

- Sun: 4 (allows procedural noise detail)
- Earth: 0.5 (allows texture detail)
- Moon: 0.135 (EARTH_R × 0.27)
- Planets: `(radiusKm / 6371) * 0.5` (proportional, for texture detail)

### Camera adaptation

- `controls.minDistance` adapts to the focused body's true radius (×2.5),
  allowing close approach to small bodies.
- `camera.near` adapts to prevent clipping when zoomed in.

### Documented Exceptions

- **Moon orbital distance**: Fixed at 2.5 scene units from Earth (true
  proportional = 0.13). Keeps the Earth–Moon pair visually separable at
  moderate zoom. Moon body size IS perspective-faithful.

## 5. Ephemeris Sources

| Body | Source | Accuracy |
|------|--------|----------|
| Earth | VSOP87 (Bretagnon & Francou 1988) | ~1" over ±4000 years |
| Other planets | Keplerian J2000 mean elements (JPL/Standish) | ~arcminute over ±centuries |
| Moon | ELP2000-simplified | ~10' |
| Stars | Hipparcos catalog (bright stars) + procedural fill | Positionally accurate |

## 6. Galactic Motion

The Sun moves through the Milky Way at ~230 km/s. This is real physics but
it is a shared motion — all bodies in the solar system move together.

**Data layer**: All positions and trajectory points are pure heliocentric.
Galactic drift is never baked into position data.

**Visualization layer**: Trajectory lines (past/future paths) add a
compressed galactic drift (8× compression, pitch:radius ≈ 5.75:1) to
create the spiral/helix that shows each body's true path through the
galaxy. This applies uniformly to all bodies — Earth, planets, and the
Sun's straight-line path. The drift direction and speed come from SceneData
but are only used when building the visual trajectory meshes.

## 7. Time

- Internal time: Julian Date (JD) in TDB (Barycentric Dynamical Time)
- User-facing time: UTC via JavaScript Date
- Trajectory range: ±100 years from "now"
- Time travel: offset in hours from Date.now(), applied uniformly to all
  body position computations

## 8. Scene Architecture

```
scene
├── starfield (follows camera, infinite distance)
└── scenePivot (rotatable for ecliptic/equatorial/galactic up-frame)
    ├── Sun meshes at (0,0,0)
    ├── earthGroup at eclToThree(earthHelio) * AU_SCENE
    │   ├── Earth mesh (local origin)
    │   ├── Clouds, atmosphere
    │   ├── Axis line, pole sweep
    │   ├── Location marker
    │   └── Moon at local offset
    ├── Planet meshes at eclToThree(helio) * AU_SCENE
    ├── Planet orbit path lines (centered on origin)
    ├── Trajectory lines (absolute heliocentric positions)
    └── Ghost group (absolute heliocentric position at ghost time)
```

## 9. Rules for Future Development

1. Never introduce a second coordinate scale. One AU, one conversion.
2. Never position a body relative to another body. Use absolute heliocentric.
3. Galactic drift is a frame transformation, not a position offset.
4. When adding a new body, derive its sceneRadius from radiusKm using the formula.
5. Prefer real ephemeris data over approximations. If accuracy matters, use VSOP87.
6. Document any exception to these principles in this file.
