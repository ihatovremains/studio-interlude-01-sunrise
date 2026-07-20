# Studio Interlude 01 — Where the Viewer Stands

A 17-second, native 4:5 motion study that shows one Tokyo sunrise from two continuous reference frames:

- Human view: `The Sun rises.`
- System view: `Tokyo rotates into daylight.`
- Design meaning: `Every interface chooses where the viewer stands.`

This is a motion-design prototype, not a scale model of the solar system. Tokyo's displayed `≈ 1,350 km/h eastward` surface speed is approximate, and the rotational sequence is explicitly time-compressed.

**Live study:** https://ihatovremains.github.io/studio-interlude-01-sunrise/

## Run

Open `index.html` in a modern browser.

- `R`: replay from the beginning
- `Space`: play / pause
- Scrubber: inspect any point in the 17-second timeline
- `?capture=1`: fixed capture state with controls and cursor hidden

## Deterministic render API

```js
window.studioInterlude.renderAt(11.5)
window.studioInterlude.duration() // 17
window.studioInterlude.state()
```

The Sun and daylight boundary remain fixed in the system view. The graticule and Tokyo marker are projected from the same rotation value, so Tokyo crosses into daylight at exactly 11.5 seconds.

## Posting master

`studio-interlude-01-social-1080x1350-master.mp4`

- 1080×1350 · 4:5
- 17.000 seconds · 510 frames · constant 30 fps
- H.264 High Profile 4.1 · yuv420p · BT.709
- AAC-LC · 48 kHz stereo · 192 kbps
- Deterministic DPR2 browser render, downsampled with Lanczos
- Original synthesized sound design; no external audio assets

The soundtrack remains non-essential to comprehension because LinkedIn may autoplay without sound. It fades to near-silence before the automatic loop boundary.

## Production checks

```sh
node render-keyframes.mjs
node qa-production.mjs
./render-video.sh --smoke --clean
./render-video.sh --clean
```

The full QA verifies the 1080×1350 capture viewport, deterministic A→B→A seeking, Tokyo's boundary crossing, a static 14.0–16.966 second closing, fixed Sun coordinates, all 510 decoded frames, H.264/AAC stream properties, BT.709 metadata, loudness, loop-boundary silence, and frame-to-frame continuity.

## Sound direction

- Ground view: quiet, abstract dawn texture
- Pullback: the texture thins instead of adding a cinematic whoosh
- System view: one low rotational pulse, not a repeating rhythm
- 11.5-second crossing: one restrained harmonic change
- Closing: a stable bed that fades to silence by 17 seconds
