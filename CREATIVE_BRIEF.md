# STUDIO INTERLUDE 01 — Creative Brief

## Working title

**Where the Viewer Stands**

## One-sentence promise

Show one Tokyo sunrise through two continuous reference frames—first as a human experience, then as a causal system—to reveal that every interface chooses where the viewer stands.

## Core idea

This is not an astronomy lesson. Sunrise is the example used to make a design principle felt:

> From Tokyo, the Sun rises.  
> From the system view, Tokyo rotates into daylight.  
> Same event. Different frame.

The approximately **1,350 km/h eastward surface speed** is supporting evidence, not the headline. The final meaning is:

> Every interface chooses where the viewer stands.

## Why it matters

User experience and system causality are often different views of the same event. A useful interface does not expose every mechanism; it deliberately selects the frame that helps someone understand or decide.

This connects the Studio Interlude to Takaaki Suzuki's broader body of work without mentioning AI: translating an invisible system into a clear human view is itself the design act.

## Locked format

- Native canvas: **1080 × 1350 (4:5)**
- Locked duration: **17.0 seconds · 510 frames at 30fps**
- One uninterrupted camera movement; no slide cuts
- One persistent Sun and one persistent Earth
- Label: `STUDIO INTERLUDE · 01`
- No sequel teaser, GitHub callout, or technical end card inside the film

## Five keyframes

| Frame | Time | Visual state | On-screen language |
|---|---:|---|---|
| 01 — Human view | 1.5s | Tokyo skyline at dawn. The Sun appears over the horizon. The scale feels human and local. | `HUMAN VIEW · TOKYO` / `The Sun rises.` |
| 02 — Pullback | 4.5s | Without a cut, the same curved horizon recedes. Skyline becomes a point, atmosphere becomes a rim, and Earth begins to appear. The Sun remains in the same screen position. | `From here, that is true.` then no copy during the pullback |
| 03 — System view | 8.0s | Camera locks in a solar-fixed view. The globe and Tokyo rotate while the Sun remains stable. Spherical shading, a fixed terminator, and quiet `NIGHT / DAYLIGHT` labels make the boundary unambiguous. | `SYSTEM VIEW · CAUSE` / `Tokyo rotates into daylight.` |
| 04 — Same event | 11.5s | Tokyo crosses the daylight boundary. A restrained halo marks the crossing. A short trail makes the motion legible. | `Same event. Different frame.` / `≈ 1,350 KM/H EASTWARD · TIME COMPRESSED` |
| 05 — Design meaning | 15.5s | The motion settles into a composed Earth–Sun frame. All telemetry recedes so the design thesis has clear space. | `Every interface chooses where the viewer stands.` |

## Visual grammar

- Begin with a familiar, almost photographic horizon composition; end with a calm, legible system view.
- The ground horizon and final globe must be the same geometric Earth object at different camera scales.
- Keep the Sun in one screen position through the pullback so the reference-frame change is visible without explanation.
- Remove the rectangular light field entirely.
- Do not draw a spotlight cone. Use a fixed Sun glow, spherical day-side shading, a soft terminator, a thin atmospheric rim, and quiet in-globe `NIGHT / DAYLIGHT` labels.
- Introduce the longitude grid only as the camera reaches space; it should clarify rotation, not make the piece look like a chart.
- Preserve Tokyo as the continuity anchor: skyline → point → moving surface marker.
- Use `HUMAN VIEW` and `SYSTEM VIEW` as quiet framing labels, not interface tabs or cards.
- Keep the final composition bright, simple, and spacious. Avoid dashboard chrome, particles, flags, landmarks, and science-documentary spectacle.

## Motion grammar

- **0–3.55s:** the horizon moves relative to the fixed Sun, producing the familiar sunrise experience.
- **3.0–7.75s:** one continuous pullback from ground to space; copy disappears during the transformation.
- **7.75–12.5s:** camera locks; Earth, its grid, and Tokyo rotate together while the Sun and terminator stay fixed. Tokyo crosses at **11.50s**.
- **12.5–13.3s:** rotational motion decelerates smoothly and telemetry recedes.
- **13.2–17.0s:** the final design thesis appears; the composition is fully static from **14.0s** through the end.
- The motion plays once. Replay is available only in the interactive prototype.
- Honor reduced-motion preferences with the final explanatory state.

## Data and accuracy contract

- Tokyo reference coordinate: approximately **35.7°N, 139.7°E**.
- `≈ 1,350 km/h east` describes Tokyo's approximate eastward surface speed from Earth's rotation: equatorial circumference × cos(latitude) ÷ 24 hours.
- Label the motion `TIME COMPRESSED`; do not imply real-time rotational speed.
- Do not display an exact sunrise time without a specific date and solar-position calculation.
- Camera scale, Sun/Earth size, and separation are illustrative and must not be presented as physically proportional.
- The final system view must keep sunlight direction stable while the graticule and Tokyo rotate from the same time value.

## Exact on-screen language

```text
STUDIO INTERLUDE · 01

HUMAN VIEW · TOKYO
The Sun rises.

From here, that is true.

SYSTEM VIEW · CAUSE
Tokyo rotates into daylight.

Same event. Different frame.
≈ 1,350 KM/H EASTWARD · TIME COMPRESSED

Every interface chooses where the viewer stands.
```

## Sound direction

- Start with a quiet, grounded room-tone or dawn-tone texture.
- Let the pullback thin the sound rather than add a cinematic whoosh.
- Introduce one low rotational pulse only after the system view becomes visible.
- Mark Tokyo's boundary crossing with one restrained harmonic change.
- Remove telemetry sonification and the eight-city orchestration from the previous concept; sound supports the frame change, not planetary data.

## Approval gate

Show the five frames at phone-feed size, without explaining the concept, and ask:

1. What did the first view make you think was moving?
2. What did the pullback reveal was moving?
3. Why is `≈ 1,350 km/h` shown?
4. What does `Same event. Different frame.` mean here?
5. What do you think the final line says about interface design?

Pass condition: viewers can distinguish experience from cause and explain that an interface deliberately chooses a point of view. If they answer only “Earth rotates,” the visual is clear but the design thesis is not yet landing.

## Production handoff

Use one time-addressable animation timeline and generate all five keyframes and the final master from it. Reuse the deterministic capture and QA pipeline from MACHINE TEMPO, but not its visual language. Verify the fixed Sun position, continuous Earth geometry, Tokyo's boundary crossing, mobile-safe copy, and absence of copy/visual overlap at every keyframe.
