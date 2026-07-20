#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.resolve(ROOT, process.argv.find(argument => argument.startsWith('--video='))?.slice(8) || 'studio-interlude-01-social-1080x1350-master.mp4');
const RENDER = path.join(ROOT, 'render');
const FRAMES = path.join(RENDER, 'frames');
const CAPTURE_QA = path.join(RENDER, 'capture-qa.json');
const AUDIO_QA = path.join(RENDER, 'audio-qa.json');
const ASSETS = path.join(ROOT, 'assets');
const REPORT = path.join(RENDER, 'verification.json');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const FPS = 30;
const DURATION = 17;
const FRAME_COUNT = 510;
const failures = [];

function run(command, args, options = {}) {
  const encoding = Object.prototype.hasOwnProperty.call(options, 'encoding') ? options.encoding : 'utf8';
  return execFileSync(command, args, {
    encoding,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  });
}

function runBoth(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed.\n${result.stderr || result.stdout}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function parseRate(rate) {
  const [numerator, denominator] = String(rate || '0/1').split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}

function pcmRmsDb(buffer, startSeconds, endSeconds, sampleRate = 48_000, channels = 2) {
  const bytesPerFrame = channels * 2;
  const first = Math.max(0, Math.floor(startSeconds * sampleRate));
  const last = Math.min(Math.floor(buffer.length / bytesPerFrame), Math.ceil(endSeconds * sampleRate));
  let sum = 0;
  let count = 0;
  for (let frame = first; frame < last; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = buffer.readInt16LE(frame * bytesPerFrame + channel * 2) / 32768;
      sum += sample * sample;
      count += 1;
    }
  }
  if (!count || sum === 0) return -Infinity;
  return 20 * Math.log10(Math.sqrt(sum / count));
}

function parseLoudnorm(stderr) {
  const matches = String(stderr).match(/\{[\s\S]*?"input_i"[\s\S]*?\}/g);
  return matches?.length ? JSON.parse(matches.at(-1)) : null;
}

function frameDiffReport() {
  const output = run(FFMPEG, [
    '-hide_banner', '-v', 'error', '-i', VIDEO,
    '-vf', 'tblend=all_mode=difference,signalstats,metadata=print:file=-',
    '-an', '-f', 'null', '-'
  ]);
  const rows = [];
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    const header = line.match(/^frame:(\d+)\s+pts:\S+\s+pts_time:([\d.]+)/);
    if (header) {
      current = { frame: Number(header[1]), timeSeconds: Number(header[2]), yAverage: null };
      rows.push(current);
      continue;
    }
    const yAverage = line.match(/^lavfi\.signalstats\.YAVG=(\S+)/);
    if (yAverage && current) current.yAverage = Number(yAverage[1]);
  }
  const valid = rows.filter(row => Number.isFinite(row.yAverage));
  const largest = [...valid].sort((a, b) => b.yAverage - a.yAverage).slice(0, 12);
  const handoffTimes = [2.25, 3, 7.75, 8, 10.5, 11.5, 12.5, 13.2, 14];
  return {
    comparedFrames: valid.length,
    maxAverageLumaDelta: largest[0]?.yAverage ?? null,
    largestDeltas: largest,
    handoffDeltas: handoffTimes.map(time => {
      const nearest = valid.reduce((best, row) => Math.abs(row.timeSeconds - time) < Math.abs(best.timeSeconds - time) ? row : best, valid[0]);
      return { expectedTime: time, ...nearest };
    })
  };
}

function makeQaAssets() {
  fs.mkdirSync(ASSETS, { recursive: true });
  const keys = [
    ['human', 1.5],
    ['pullback', 4.5],
    ['system', 8],
    ['crossing', 11.5],
    ['closing', 15.5]
  ];
  for (const [name, time] of keys) {
    run(FFMPEG, ['-y', '-ss', String(time), '-i', VIDEO, '-frames:v', '1', path.join(ASSETS, `master-key-${name}.png`)]);
  }
  run(FFMPEG, [
    '-y', '-i', VIDEO,
    '-vf', `fps=5/${DURATION},scale=360:450:flags=lanczos,tile=3x2:padding=0:margin=0`,
    '-frames:v', '1', '-q:v', '2', path.join(ASSETS, 'master-contact-sheet.jpg')
  ]);
  run(FFMPEG, [
    '-y', '-i', VIDEO,
    '-vf', 'trim=start_frame=0:end_frame=12,scale=270:338:flags=lanczos,tile=4x3:padding=0:margin=0',
    '-frames:v', '1', '-q:v', '2', path.join(ASSETS, 'qa-opening-twelve-frames.jpg')
  ]);
  run(FFMPEG, [
    '-y', '-ss', '11.3', '-t', '0.4', '-i', VIDEO,
    '-vf', 'fps=30,scale=270:338:flags=lanczos,tile=4x3:padding=0:margin=0',
    '-frames:v', '1', '-q:v', '2', path.join(ASSETS, 'qa-crossing-twelve-frames.jpg')
  ]);
  run(FFMPEG, [
    '-y', '-i', VIDEO,
    '-filter_complex', 'aformat=channel_layouts=stereo,showwavespic=s=1080x300:split_channels=1:colors=#4f92d1|#f29a50',
    '-frames:v', '1', path.join(ASSETS, 'qa-audio-waveform.png')
  ]);
}

function main() {
  assert(fs.existsSync(VIDEO), `Missing final video: ${VIDEO}`);
  assert(fs.existsSync(CAPTURE_QA), `Missing capture QA: ${CAPTURE_QA}`);
  assert(fs.existsSync(AUDIO_QA), `Missing audio QA: ${AUDIO_QA}`);
  if (failures.length) throw new Error(failures.join('\n'));

  const probe = JSON.parse(run(FFPROBE, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', VIDEO]));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const bitRate = Number(probe.format.bit_rate);
  assert(video?.width === 1080 && video?.height === 1350, `Video is ${video?.width}x${video?.height}; expected 1080x1350.`);
  assert(video?.codec_name === 'h264', `Video codec is ${video?.codec_name}; expected H.264.`);
  assert(String(video?.profile).toLowerCase() === 'high', `Video profile is ${video?.profile}; expected High.`);
  assert(Number(video?.level) === 41, `Video level is ${video?.level}; expected 4.1.`);
  assert(video?.pix_fmt === 'yuv420p', `Pixel format is ${video?.pix_fmt}; expected yuv420p.`);
  assert(video?.avg_frame_rate === '30/1' && Math.abs(parseRate(video?.r_frame_rate) - FPS) < 1e-9, `Frame rates are ${video?.avg_frame_rate}/${video?.r_frame_rate}; expected CFR 30.`);
  assert(Number(video?.nb_read_frames) === FRAME_COUNT, `Decoded video frame count is ${video?.nb_read_frames}; expected ${FRAME_COUNT}.`);
  assert(Math.abs(duration - DURATION) <= .035, `Container duration is ${duration}s; expected ${DURATION}s.`);
  assert(video?.color_primaries === 'bt709' && video?.color_transfer === 'bt709' && video?.color_space === 'bt709', `Video color metadata is ${video?.color_primaries}/${video?.color_transfer}/${video?.color_space}; expected BT.709.`);
  assert(audio?.codec_name === 'aac', `Audio codec is ${audio?.codec_name}; expected AAC.`);
  assert(Number(audio?.sample_rate) === 48_000, `Audio sample rate is ${audio?.sample_rate}; expected 48000.`);
  assert(Number(audio?.channels) === 2, `Audio channels are ${audio?.channels}; expected stereo.`);
  assert(bitRate >= 192_000 && bitRate <= 30_000_000, `Container bitrate is ${bitRate}; LinkedIn accepts 192 kbps–30 Mbps.`);
  assert(fs.statSync(VIDEO).size < 5 * 1024 ** 3, 'Video exceeds LinkedIn’s 5 GB limit.');

  const captureQa = JSON.parse(fs.readFileSync(CAPTURE_QA, 'utf8'));
  const audioQa = JSON.parse(fs.readFileSync(AUDIO_QA, 'utf8'));
  assert(captureQa.passed, `Capture QA failed: ${JSON.stringify(captureQa)}`);
  assert(captureQa.aToBToASeekPixelIdentical, 'A→B→A deterministic seek failed.');
  assert(captureQa.resetToFirstFrameIdentical, 'Reset after full capture does not reproduce frame 1.');
  assert(captureQa.closingFramesIdentical && captureQa.closingHoldFrameCount === 90, 'The 14.0–16.966 second source closing is not exactly static for 90 frames.');
  assert(captureQa.fixedSunCoordinates, 'Sun coordinates changed during capture.');
  assert(captureQa.daylightTransitionCount === 1, `Tokyo daylight state changed ${captureQa.daylightTransitionCount} times; expected once.`);
  assert(captureQa.tokyoDaylightBeforeCrossing === false && captureQa.tokyoDaylightAtCrossing === true, 'Tokyo did not cross the boundary at exactly 11.5 seconds.');
  assert(audioQa.passed, `Audio normalization QA failed: ${JSON.stringify(audioQa)}`);

  const frameFiles = fs.readdirSync(FRAMES).filter(name => /^frame_\d{6}\.png$/.test(name)).sort();
  assert(frameFiles.length === FRAME_COUNT, `Render frame directory has ${frameFiles.length} frames; expected ${FRAME_COUNT}.`);
  for (let frame = 0; frame < frameFiles.length; frame += 1) {
    const expected = `frame_${String(frame + 1).padStart(6, '0')}.png`;
    if (frameFiles[frame] !== expected) {
      failures.push(`Frame sequence discontinuity at ${frame}: ${frameFiles[frame]} vs ${expected}.`);
      break;
    }
  }

  const pcm = run(FFMPEG, ['-v', 'error', '-i', VIDEO, '-map', '0:a:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-'], { encoding: null, maxBuffer: 8 * 1024 * 1024 });
  const overallRmsDb = pcmRmsDb(pcm, 0, DURATION);
  const finalTenthRmsDb = pcmRmsDb(pcm, 16.9, 17);
  assert(overallRmsDb > -35 && overallRmsDb < -8, `Overall decoded audio RMS is ${overallRmsDb.toFixed(2)} dBFS.`);
  assert(finalTenthRmsDb === -Infinity || finalTenthRmsDb <= -42, `Final 0.1s decoded audio RMS is ${finalTenthRmsDb.toFixed(2)} dBFS; loop boundary may click.`);

  let masterLoudness = null;
  const measured = parseLoudnorm(runBoth(FFMPEG, [
    '-hide_banner', '-nostats', '-i', VIDEO,
    '-af', 'loudnorm=I=-17:TP=-1.5:LRA=5:print_format=json',
    '-f', 'null', '-'
  ]).stderr);
  if (measured) {
    masterLoudness = { integratedLufs: Number(measured.input_i), truePeakDbtp: Number(measured.input_tp), loudnessRangeLu: Number(measured.input_lra) };
    assert(Math.abs(masterLoudness.integratedLufs - (-17)) <= .8, `AAC master loudness is ${masterLoudness.integratedLufs} LUFS; expected about -17.`);
    assert(masterLoudness.truePeakDbtp <= -1, `AAC master true peak is ${masterLoudness.truePeakDbtp} dBTP; expected <= -1.`);
  } else {
    failures.push('Could not parse AAC master loudness analysis.');
  }

  const diffs = frameDiffReport();
  assert(diffs.comparedFrames >= FRAME_COUNT - 2, `Only ${diffs.comparedFrames} frame differences were measured.`);
  assert(diffs.maxAverageLumaDelta == null || diffs.maxAverageLumaDelta < 32, `Detected a gross full-frame discontinuity (average luma delta ${diffs.maxAverageLumaDelta}).`);
  makeQaAssets();

  const report = {
    passed: failures.length === 0,
    video: VIDEO,
    bytes: fs.statSync(VIDEO).size,
    durationSeconds: duration,
    bitRate,
    videoStream: {
      codec: video?.codec_name,
      profile: video?.profile,
      level: video?.level,
      pixelFormat: video?.pix_fmt,
      width: video?.width,
      height: video?.height,
      averageFrameRate: video?.avg_frame_rate,
      decodedFrames: Number(video?.nb_read_frames),
      color: [video?.color_primaries, video?.color_transfer, video?.color_space]
    },
    audioStream: {
      codec: audio?.codec_name,
      sampleRate: Number(audio?.sample_rate),
      channels: Number(audio?.channels),
      overallRmsDb,
      finalTenthRmsDb,
      ...masterLoudness
    },
    deterministicCapture: {
      oneContinuousPass: true,
      aToBToASeekPixelIdentical: captureQa.aToBToASeekPixelIdentical,
      resetToFirstFrameIdentical: captureQa.resetToFirstFrameIdentical,
      stableClosingHoldFrames: captureQa.closingHoldFrameCount,
      fixedSunCoordinates: captureQa.fixedSunCoordinates,
      daylightTransitionCount: captureQa.daylightTransitionCount
    },
    frameDiffDiagnostics: diffs,
    qaAssets: {
      contactSheet: path.join(ASSETS, 'master-contact-sheet.jpg'),
      openingFrames: path.join(ASSETS, 'qa-opening-twelve-frames.jpg'),
      crossingFrames: path.join(ASSETS, 'qa-crossing-twelve-frames.jpg'),
      waveform: path.join(ASSETS, 'qa-audio-waveform.png')
    },
    failures
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) process.exit(1);
  process.stdout.write('Studio Interlude 01 video verification passed.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exit(1);
}
