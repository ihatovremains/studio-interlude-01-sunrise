#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_HTML = path.join(ROOT, 'index.html');
const FPS = 30;
const DURATION_SECONDS = 17;
const FRAME_COUNT = 510;
const CLOSING_START_FRAME = 14 * FPS;
const VIEWPORT = { width: 1080, height: 1350 };
const DPR = 2;
const EXPECTED_PNG = { width: 2160, height: 2700 };
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const NODE = process.execPath;

function option(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(argument => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const flags = new Set(process.argv.slice(2).filter(argument => !argument.includes('=')));
const smoke = flags.has('--smoke');
const clean = flags.has('--clean');
const encodeOnly = flags.has('--encode-only');
const audioOnly = flags.has('--audio-only');
const renderOnly = flags.has('--render-only') || smoke;
const renderRoot = path.resolve(ROOT, option('--render-dir', smoke ? 'render-smoke' : 'render'));
const framesDir = path.join(renderRoot, 'frames');
const telemetryPath = path.join(renderRoot, 'capture-telemetry.jsonl');
const captureQaPath = path.join(renderRoot, 'capture-qa.json');
const manifestPath = path.join(renderRoot, 'manifest.json');
const audioEventsPath = path.join(renderRoot, 'audio-events.json');
const rawWavPath = path.join(renderRoot, 'studio-interlude-01-raw-48k-stereo.wav');
const normalizedWavPath = path.join(renderRoot, 'studio-interlude-01-48k-stereo.wav');
const audioSynthesisQaPath = path.join(renderRoot, 'audio-synthesis-qa.json');
const audioQaPath = path.join(renderRoot, 'audio-qa.json');
const videoOnlyPath = path.join(renderRoot, 'studio-interlude-01-video-only.mp4');
const masterPath = path.resolve(ROOT, option('--output', 'studio-interlude-01-social-1080x1350-master.mp4'));

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function framePath(frame) {
  return path.join(framesDir, `frame_${String(frame + 1).padStart(6, '0')}.png`);
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('Captured output is not a PNG.');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const runtimeRoot = path.resolve(path.dirname(process.execPath), '..');
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    path.join(runtimeRoot, 'node_modules', 'playwright')
  ].filter(Boolean);
  const errors = [];
  for (const candidate of candidates) {
    try {
      return { module: require(candidate), resolvedPath: require.resolve(candidate) };
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Playwright could not be resolved.\n${errors.join('\n')}`);
}

function chromiumExecutable(chromium) {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    (() => { try { return chromium.executablePath(); } catch { return null; } })()
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`No Chromium-family browser found. Checked:\n${candidates.join('\n')}`);
  return found;
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`\n${label}\n`);
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${label} failed with exit code ${code}.`)));
  });
}

function runCaptured(command, args, label) {
  process.stdout.write(`\n${label}\n`);
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} failed.\n${result.stderr || result.stdout}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function captureScreenshot(page, outputPath) {
  return page.screenshot({ path: outputPath, type: 'png', scale: 'device', animations: 'allow', caret: 'hide' });
}

function exactFrameList(files) {
  return files.filter(name => /^frame_\d{6}\.png$/.test(name)).sort();
}

async function validateFullFrameSequence() {
  const files = exactFrameList(await fsp.readdir(framesDir));
  if (files.length !== FRAME_COUNT) throw new Error(`Expected exactly ${FRAME_COUNT} PNG frames; found ${files.length}.`);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const expected = `frame_${String(frame + 1).padStart(6, '0')}.png`;
    if (files[frame] !== expected) throw new Error(`Frame sequence gap or reorder at index ${frame}: expected ${expected}, found ${files[frame]}.`);
  }
}

function parseLoudnormJson(stderr) {
  const matches = String(stderr).match(/\{[\s\S]*?"input_i"[\s\S]*?\}/g);
  if (!matches?.length) throw new Error(`FFmpeg loudnorm did not return JSON.\n${stderr}`);
  return JSON.parse(matches.at(-1));
}

async function normalizeAudio() {
  await run(NODE, [
    path.join(ROOT, 'render-audio.mjs'),
    `--events=${audioEventsPath}`,
    `--output=${rawWavPath}`,
    `--report=${audioSynthesisQaPath}`,
    `--duration=${DURATION_SECONDS}`
  ], 'Synthesizing deterministic 48 kHz stereo sound design');

  const target = 'I=-17:TP=-1.5:LRA=5';
  const firstPass = runCaptured(FFMPEG, [
    '-hide_banner', '-nostats', '-i', rawWavPath,
    '-af', `loudnorm=${target}:print_format=json`,
    '-f', 'null', '-'
  ], 'Analyzing source loudness');
  const measured = parseLoudnormJson(firstPass.stderr);
  const secondFilter = [
    `loudnorm=${target}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=summary'
  ].join(':');
  await run(FFMPEG, [
    '-y', '-hide_banner', '-i', rawWavPath,
    '-af', secondFilter,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', '-t', String(DURATION_SECONDS),
    normalizedWavPath
  ], 'Normalizing sound design to -17 LUFS / -1.5 dBTP');

  const normalizedAnalysis = runCaptured(FFMPEG, [
    '-hide_banner', '-nostats', '-i', normalizedWavPath,
    '-af', `loudnorm=${target}:print_format=json`,
    '-f', 'null', '-'
  ], 'Verifying normalized WAV loudness');
  const normalized = parseLoudnormJson(normalizedAnalysis.stderr);
  const probe = JSON.parse(runCaptured(FFPROBE, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', normalizedWavPath
  ], 'Probing normalized WAV').stdout);
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const report = {
    passed: Math.abs(Number(normalized.input_i) - (-17)) <= .5 && Number(normalized.input_tp) <= -1.3,
    target: { integratedLufs: -17, truePeakDbtp: -1.5, loudnessRangeLu: 5 },
    firstPass: measured,
    normalized,
    durationSeconds: Number(probe.format.duration),
    sampleRate: Number(audio.sample_rate),
    channels: Number(audio.channels),
    source: rawWavPath,
    output: normalizedWavPath
  };
  if (!report.passed) throw new Error(`Normalized WAV missed the loudness target: ${JSON.stringify(report.normalized)}`);
  await fsp.writeFile(audioQaPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function encode() {
  await validateFullFrameSequence();
  if (!fs.existsSync(audioEventsPath)) throw new Error(`Missing page-exported audio plan: ${audioEventsPath}`);
  await normalizeAudio();
  await run(FFMPEG, [
    '-y', '-framerate', String(FPS), '-start_number', '1', '-i', path.join(framesDir, 'frame_%06d.png'),
    '-frames:v', String(FRAME_COUNT),
    '-vf', 'scale=1080:1350:flags=lanczos,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-an', '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.1', '-refs', '4',
    '-crf', '17', '-preset', 'slow', '-tune', 'animation',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-r', String(FPS), '-fps_mode', 'cfr', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    videoOnlyPath
  ], 'Encoding 510 lossless frames to H.264 High video');
  await run(FFMPEG, [
    '-y', '-i', videoOnlyPath, '-i', normalizedWavPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', String(DURATION_SECONDS), '-movflags', '+faststart',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    masterPath
  ], `Muxing final master: ${masterPath}`);
}

function smokeTimes() {
  return [0, 1.5, 2.25, 3, 4.5, 7.75, 8, 10.5, 11.466667, 11.5, 11.533333, 13.2, 14, 16.966667];
}

async function capture() {
  if (!fs.existsSync(SOURCE_HTML)) throw new Error(`Missing production source: ${SOURCE_HTML}`);
  if (clean) await fsp.rm(renderRoot, { recursive: true, force: true });
  await fsp.mkdir(framesDir, { recursive: true });
  const existing = exactFrameList(await fsp.readdir(framesDir));
  if (existing.length) throw new Error(`${framesDir} already contains ${existing.length} PNG frame(s). Use --clean.`);

  const { module: playwright, resolvedPath: playwrightPath } = loadPlaywright();
  const { chromium } = playwright;
  const executablePath = chromiumExecutable(chromium);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--hide-scrollbars', '--force-color-profile=srgb']
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    reducedMotion: 'no-preference',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Asia/Tokyo'
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || String(error)));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.goto(`${pathToFileURL(SOURCE_HTML).href}?capture=1`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'html,body,body *{cursor:none!important}.viz-controls,[data-controls],#controls,.player-controls{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}' });

  const api = await page.evaluate(() => ({
    hasRoot: Boolean(window.studioInterlude),
    renderAt: typeof window.studioInterlude?.renderAt,
    duration: typeof window.studioInterlude?.duration,
    state: typeof window.studioInterlude?.state,
    audioEvents: typeof window.studioInterlude?.audioEvents,
    durationValue: typeof window.studioInterlude?.duration === 'function' ? window.studioInterlude.duration() : null
  }));
  const missing = Object.entries(api).filter(([key, value]) => key !== 'hasRoot' && key !== 'durationValue' && value !== 'function').map(([key]) => key);
  if (!api.hasRoot || missing.length) throw new Error(`Capture API is incomplete. Missing: ${missing.join(', ') || 'window.studioInterlude'}.`);
  if (Math.abs(Number(api.durationValue) - DURATION_SECONDS) > 1e-9) throw new Error(`Page duration() is ${api.durationValue}; expected ${DURATION_SECONDS}.`);
  const audioExport = await page.evaluate(() => window.studioInterlude.audioEvents());
  if (!Array.isArray(audioExport) || audioExport.length === 0) throw new Error('window.studioInterlude.audioEvents() must return a non-empty array.');
  await fsp.writeFile(audioEventsPath, `${JSON.stringify(audioExport, null, 2)}\n`);

  await page.evaluate(() => window.studioInterlude.renderAt(8));
  await settle(page);
  const seekA1 = await page.screenshot({ type: 'png', scale: 'device', animations: 'allow', caret: 'hide' });
  await page.evaluate(() => window.studioInterlude.renderAt(11.5));
  await settle(page);
  await page.evaluate(() => window.studioInterlude.renderAt(8));
  await settle(page);
  const seekA2 = await page.screenshot({ type: 'png', scale: 'device', animations: 'allow', caret: 'hide' });
  const seekDeterministic = sha256(seekA1) === sha256(seekA2);
  if (!seekDeterministic) throw new Error('A→B→A renderAt() seek is not pixel-deterministic.');

  const times = smoke ? smokeTimes() : Array.from({ length: FRAME_COUNT }, (_, frame) => frame / FPS);
  const telemetry = [];
  const closingHashes = [];
  let firstFrameBuffer = null;
  let dimensions = null;
  let uiLeak = null;
  const startedAt = Date.now();
  process.stdout.write(`Capturing ${smoke ? `${times.length} smoke frames` : `${FRAME_COUNT} continuous frames`} at ${EXPECTED_PNG.width}x${EXPECTED_PNG.height} PNG\n`);
  for (let index = 0; index < times.length; index += 1) {
    const timeSeconds = times[index];
    const frame = smoke ? Math.round(timeSeconds * FPS) : index;
    await page.evaluate(time => window.studioInterlude.renderAt(time), timeSeconds);
    await settle(page);
    const state = await page.evaluate(({ frame, timeSeconds }) => {
      const visibleControls = [...document.querySelectorAll('.viz-controls,[data-controls],#controls,.player-controls')].filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .001;
      }).length;
      return {
        frame,
        timeSeconds,
        apiState: window.studioInterlude.state(),
        bodyCursor: getComputedStyle(document.body).cursor,
        visibleControls
      };
    }, { frame, timeSeconds });
    if (!uiLeak && (state.visibleControls !== 0 || state.bodyCursor !== 'none')) uiLeak = state;
    const output = smoke
      ? path.join(framesDir, `smoke_${String(index + 1).padStart(2, '0')}_${timeSeconds.toFixed(3).replace('.', '_')}s.png`)
      : framePath(frame);
    const buffer = await captureScreenshot(page, output);
    if (!dimensions) dimensions = pngDimensions(buffer);
    if (dimensions.width !== EXPECTED_PNG.width || dimensions.height !== EXPECTED_PNG.height) {
      throw new Error(`Captured PNG is ${dimensions.width}x${dimensions.height}; expected ${EXPECTED_PNG.width}x${EXPECTED_PNG.height}.`);
    }
    if (!smoke && frame === 0) firstFrameBuffer = buffer;
    if (!smoke && frame >= CLOSING_START_FRAME) closingHashes.push(sha256(buffer));
    telemetry.push(state);
    if (index % 30 === 0 || index === times.length - 1) {
      process.stdout.write(`frame ${index + 1}/${times.length} · t=${timeSeconds.toFixed(3)}s · ${((Date.now() - startedAt) / 1000).toFixed(1)}s wall\n`);
    }
  }

  let resetToFirstFrameIdentical = null;
  if (!smoke) {
    await page.evaluate(() => window.studioInterlude.renderAt(0));
    await settle(page);
    const resetBuffer = await page.screenshot({ type: 'png', scale: 'device', animations: 'allow', caret: 'hide' });
    resetToFirstFrameIdentical = sha256(resetBuffer) === sha256(firstFrameBuffer);
  }
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3_000))]);
  if (browserErrors.length) throw new Error(`Browser errors:\n${browserErrors.join('\n')}`);
  if (uiLeak) throw new Error(`Capture UI or cursor leaked at t=${uiLeak.timeSeconds}s.`);
  if (!smoke) await validateFullFrameSequence();

  const sunCoordinates = new Set(telemetry.map(row => JSON.stringify(row.apiState.sun)));
  const systemTelemetry = telemetry.filter(row => row.timeSeconds >= 8.05);
  const transitions = systemTelemetry.reduce((count, row, index) => {
    if (!index) return count;
    return count + (systemTelemetry[index - 1].apiState.tokyoDaylight !== row.apiState.tokyoDaylight ? 1 : 0);
  }, 0);
  const beforeCrossing = telemetry.find(row => Math.abs(row.timeSeconds - 11.4666666667) < .001)?.apiState.tokyoDaylight;
  const atCrossing = telemetry.find(row => Math.abs(row.timeSeconds - 11.5) < .001)?.apiState.tokyoDaylight;
  const closingHoldIdentical = smoke ? null : closingHashes.length === FRAME_COUNT - CLOSING_START_FRAME && new Set(closingHashes).size === 1;
  const captureQa = {
    passed: seekDeterministic && !uiLeak && sunCoordinates.size === 1 && (smoke || (resetToFirstFrameIdentical && closingHoldIdentical && transitions === 1 && beforeCrossing === false && atCrossing === true)),
    smoke,
    aToBToASeekPixelIdentical: seekDeterministic,
    resetToFirstFrameIdentical,
    closingFramesIdentical: closingHoldIdentical,
    closingHoldFrameCount: smoke ? null : closingHashes.length,
    fixedSunCoordinates: sunCoordinates.size === 1,
    daylightTransitionCount: transitions,
    tokyoDaylightBeforeCrossing: beforeCrossing,
    tokyoDaylightAtCrossing: atCrossing,
    controlsAndCursorHidden: !uiLeak,
    dimensions,
    capturedFrames: times.length,
    expectedFullFrameCount: FRAME_COUNT,
    browserErrors
  };
  if (!captureQa.passed) throw new Error(`Capture QA failed:\n${JSON.stringify(captureQa, null, 2)}`);
  await fsp.writeFile(telemetryPath, `${telemetry.map(row => JSON.stringify(row)).join('\n')}\n`);
  await fsp.writeFile(captureQaPath, `${JSON.stringify(captureQa, null, 2)}\n`);
  await fsp.writeFile(manifestPath, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    sourceSha256: sha256(await fsp.readFile(SOURCE_HTML)),
    rendererSha256: sha256(await fsp.readFile(fileURLToPath(import.meta.url))),
    playwrightPath,
    chromiumExecutable: executablePath,
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    pngDimensions: dimensions,
    fps: FPS,
    durationSeconds: DURATION_SECONDS,
    frameCount: smoke ? times.length : FRAME_COUNT,
    continuousSinglePass: !smoke,
    deterministicRenderApi: 'window.studioInterlude.renderAt(seconds)',
    pageAudioEventApi: 'window.studioInterlude.audioEvents()',
    captureQa
  }, null, 2)}\n`);
  process.stdout.write(`Capture QA passed: ${captureQaPath}\n`);
}

async function main() {
  if (flags.has('--help') || flags.has('-h')) {
    process.stdout.write('Usage: ./render-video.sh [--clean] [--smoke] [--render-only] [--audio-only] [--encode-only] [--output=FILE]\n');
    return;
  }
  if (DURATION_SECONDS * FPS !== FRAME_COUNT) throw new Error('Internal frame-count contract is inconsistent.');
  if (audioOnly) {
    if (!fs.existsSync(audioEventsPath)) throw new Error(`Missing page-exported audio plan: ${audioEventsPath}`);
    await normalizeAudio();
    return;
  }
  if (encodeOnly) {
    await encode();
    return;
  }
  await capture();
  if (!renderOnly) await encode();
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exit(1);
});
