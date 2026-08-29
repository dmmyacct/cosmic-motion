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

## 4. Body Sizes (Tier 2 Scale)

All planet radii are proportional to each other:

```
sceneRadius = (radiusKm / 6371) * 0.5
```

This makes Earth = 0.5 scene units, Jupiter = 5.49, Mercury = 0.19, etc.
The exaggeration vs orbital distances (~235x) is standard planetarium practice
and is required for bodies to be visible at interplanetary zoom levels.

### Documented Exceptions

- **Sun radius**: Capped at ~4-5 scene units (true proportional would be 54.7,
  engulfing Mercury/Venus/Earth orbits). Corona and glow sprites extend
  visual presence.
- **Moon orbital distance**: Fixed at 2.5 scene units from Earth (true
  proportional = 0.13, inside Earth's mesh). Moon body size IS proportional.

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
