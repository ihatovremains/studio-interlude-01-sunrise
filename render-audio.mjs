#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 24;
const DEFAULT_DURATION = 17;

function option(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(argument => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const eventsPath = path.resolve(ROOT, option('--events', 'render/audio-events.json'));
const outputPath = path.resolve(ROOT, option('--output', 'render/studio-interlude-01-raw-48k-stereo.wav'));
const reportPath = path.resolve(ROOT, option('--report', 'render/audio-synthesis-qa.json'));
const duration = Number(option('--duration', DEFAULT_DURATION));

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function raised(value) {
  const p = clamp(value);
  return .5 - .5 * Math.cos(Math.PI * p);
}

function fadeIn(time, start, end) {
  return raised((time - start) / (end - start));
}

function fadeOut(time, start, end) {
  return 1 - raised((time - start) / (end - start));
}

function windowEnvelope(time, start, end, attack, release) {
  if (time < start || time >= end) return 0;
  return Math.min(fadeIn(time, start, start + attack), fadeOut(time, end - release, end));
}

function sine(frequency, time, phase = 0) {
  return Math.sin(2 * Math.PI * frequency * time + phase);
}

function lowpassCoefficient(frequency) {
  return 1 - Math.exp(-2 * Math.PI * frequency / SAMPLE_RATE);
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function readPlan() {
  if (!fs.existsSync(eventsPath)) throw new Error(`Missing page-owned audio plan: ${eventsPath}`);
  const parsed = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  const events = Array.isArray(parsed) ? parsed : parsed?.events;
  if (!Array.isArray(events)) throw new Error('Audio plan must be an array or {events:[...]} object.');
  const required = ['dawn-bed', 'pullback-air', 'system-bed', 'rotational-pulse', 'boundary-harmonic', 'closing-bed', 'master-fade'];
  for (const kind of required) {
    if (!events.some(event => event.kind === kind)) throw new Error(`Audio plan is missing “${kind}”.`);
  }
  for (const [index, event] of events.entries()) {
    const time = Number(event.time);
    const eventDuration = Number(event.duration);
    if (!Number.isFinite(time) || !Number.isFinite(eventDuration) || time < 0 || eventDuration <= 0 || time + eventDuration > duration + 1e-9) {
      throw new Error(`Audio event ${index} (${event.kind}) is outside the ${duration}s timeline.`);
    }
  }
  return events;
}

function eventMap(events) {
  return Object.fromEntries(events.map(event => [event.kind, event]));
}

function wav24(left, right) {
  const frames = left.length;
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const blockAlign = CHANNELS * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = Buffer.allocUnsafe(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  const maximum = 8_388_607;
  for (let frame = 0; frame < frames; frame += 1) {
    buffer.writeIntLE(Math.round(clamp(left[frame], -1, 1) * maximum), offset, 3);
    buffer.writeIntLE(Math.round(clamp(right[frame], -1, 1) * maximum), offset + 3, 3);
    offset += 6;
  }
  return buffer;
}

function rmsDb(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] ** 2 + right[index] ** 2;
  const rms = Math.sqrt(sum / (left.length * 2));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function main() {
  if (!Number.isFinite(duration) || duration !== 17) throw new Error(`Duration must be exactly 17 seconds; received ${duration}.`);
  const events = readPlan();
  const plan = eventMap(events);
  const sampleFrames = Math.round(duration * SAMPLE_RATE);
  const left = new Float64Array(sampleFrames);
  const right = new Float64Array(sampleFrames);
  const randomLeft = makeRandom(0x51f15e);
  const randomRight = makeRandom(0xa17d3c);

  const coefficient70 = lowpassCoefficient(70);
  const coefficient1800 = lowpassCoefficient(1_800);
  const coefficient3200 = lowpassCoefficient(3_200);
  const coefficient7200 = lowpassCoefficient(7_200);
  let low70L = 0;
  let low70R = 0;
  let low1800L = 0;
  let low1800R = 0;
  let low3200L = 0;
  let low3200R = 0;
  let air7200L = 0;
  let air7200R = 0;

  const dawn = plan['dawn-bed'];
  const pullback = plan['pullback-air'];
  const system = plan['system-bed'];
  const pulse = plan['rotational-pulse'];
  const boundary = plan['boundary-harmonic'];
  const closing = plan['closing-bed'];
  const masterFade = plan['master-fade'];
  const pulseFrequencies = pulse.frequencies;
  const boundaryFrequencies = boundary.frequencies;

  for (let sample = 0; sample < sampleFrames; sample += 1) {
    const time = sample / SAMPLE_RATE;
    const whiteL = randomLeft() * 2 - 1;
    const whiteR = randomRight() * 2 - 1;

    low70L += coefficient70 * (whiteL - low70L);
    low70R += coefficient70 * (whiteR - low70R);
    low3200L += coefficient3200 * (whiteL - low3200L);
    low3200R += coefficient3200 * (whiteR - low3200R);
    low1800L += coefficient1800 * (whiteL - low1800L);
    low1800R += coefficient1800 * (whiteR - low1800R);
    const highL = whiteL - low1800L;
    const highR = whiteR - low1800R;
    air7200L += coefficient7200 * (highL - air7200L);
    air7200R += coefficient7200 * (highR - air7200R);

    const dawnEnvelope = windowEnvelope(time, dawn.time, 7.75, .18, 4.75);
    const pullbackEnvelope = windowEnvelope(time, pullback.time, pullback.time + pullback.duration + .35, .65, .55);
    const horizonEnvelope = windowEnvelope(time, 0, dawn.time + dawn.duration, .22, .75);
    const systemEnvelope = windowEnvelope(time, system.time, 13.3, .35, .8);
    const pulseLocal = time - pulse.time;
    const pulseEnvelope = windowEnvelope(time, pulse.time, pulse.time + pulse.duration, .08, .55) * Math.exp(-Math.max(0, pulseLocal) * .8);
    const boundaryEnvelope = windowEnvelope(time, boundary.time, boundary.time + boundary.duration, .09, .42);
    const closingEnvelope = windowEnvelope(time, closing.time, closing.time + closing.duration + .65, .72, .65);
    const endFade = time < masterFade.time ? 1 : fadeOut(time, masterFade.time, masterFade.time + masterFade.duration);
    const startFade = fadeIn(time, 0, .18);

    const dawnNoiseL = (low3200L - low70L) * .016 * dawnEnvelope;
    const dawnNoiseR = (low3200R - low70R) * .016 * dawnEnvelope;
    const airNoiseL = air7200L * .0085 * pullbackEnvelope;
    const airNoiseR = air7200R * .0085 * pullbackEnvelope;

    const horizonTone = (
      sine(174.61, time) * .0075 +
      sine(261.63, time, .24) * .0035
    ) * horizonEnvelope;
    const systemTone = (
      sine(110, time) * .011 +
      sine(220, time, .18) * .0027
    ) * systemEnvelope;
    const pulseTone = (
      sine(pulseFrequencies[0], time) * .026 +
      sine(pulseFrequencies[1], time, .2) * .009
    ) * pulseEnvelope;
    const boundaryTone = (
      sine(boundaryFrequencies[0], time) * .018 +
      sine(boundaryFrequencies[1], time, .16) * .011
    ) * boundaryEnvelope;
    const closingTone = (
      sine(164.81, time) * .008 +
      sine(247.22, time, .11) * .0055 +
      sine(329.63, time, .27) * .003
    ) * closingEnvelope;

    const centered = horizonTone + systemTone + pulseTone + boundaryTone + closingTone;
    const master = startFade * endFade;
    left[sample] = (centered + dawnNoiseL * .92 + dawnNoiseR * .08 + airNoiseL * .88 + airNoiseR * .12) * master;
    right[sample] = (centered + dawnNoiseR * .92 + dawnNoiseL * .08 + airNoiseR * .88 + airNoiseL * .12) * master;
  }

  let peak = 0;
  for (let sample = 0; sample < sampleFrames; sample += 1) peak = Math.max(peak, Math.abs(left[sample]), Math.abs(right[sample]));
  const safetyScale = peak > .8 ? .8 / peak : 1;
  if (safetyScale !== 1) {
    for (let sample = 0; sample < sampleFrames; sample += 1) {
      left[sample] *= safetyScale;
      right[sample] *= safetyScale;
    }
    peak *= safetyScale;
  }
  left[sampleFrames - 1] = 0;
  right[sampleFrames - 1] = 0;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, wav24(left, right));
  const report = {
    passed: true,
    sourcePlan: eventsPath,
    output: outputPath,
    durationSeconds: duration,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    sampleFrames,
    eventCount: events.length,
    deterministicSeed: ['0x51f15e', '0xa17d3c'],
    rawPeak: peak,
    rawPeakDbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rawRmsDbfs: rmsDb(left, right),
    finalSampleIsSilent: left[sampleFrames - 1] === 0 && right[sampleFrames - 1] === 0
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exit(1);
}
