import { chromium } from '/Users/takaakisuzuki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const source = path.join(root, 'index.html');
const failures = [];
const errors = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--hide-scrollbars', '--force-color-profile=srgb']
});

try {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`${pathToFileURL(source).href}?capture=1`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => typeof window.studioInterlude?.renderAt === 'function');

  const metrics = await page.evaluate(() => ({
    duration: window.studioInterlude.duration(),
    viewport: [innerWidth, innerHeight],
    document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    externalScripts: [...document.scripts].filter((script) => script.src).map((script) => script.src)
  }));
  check(metrics.duration === 17, `duration is ${metrics.duration}, expected 17`);
  check(metrics.viewport[0] === 1080 && metrics.viewport[1] === 1350, `viewport is ${metrics.viewport.join('×')}`);
  check(metrics.document[0] === 1080 && metrics.document[1] === 1350, `document is ${metrics.document.join('×')}`);
  check(metrics.externalScripts.length === 0, `external scripts found: ${metrics.externalScripts.join(', ')}`);

  const states = {};
  for (const time of [1.5, 4.5, 8, 11.49, 11.5, 11.51, 14, 16.9]) {
    states[time] = await page.evaluate((value) => window.studioInterlude.renderAt(value), time);
  }
  check(states[8].headline === 'Tokyo rotates into daylight.', `8.0 s headline is “${states[8].headline}”`);
  check(states[8].tokyoDaylight === false, 'Tokyo should still be on the night side at 8.0 s');
  check(states[11.49].tokyoDaylight === false, 'Tokyo should still be on the night side at 11.49 s');
  check(states[11.5].tokyoDaylight === true, 'Tokyo should cross into daylight at exactly 11.5 s');
  check(states[11.51].tokyoDaylight === true, 'Tokyo should remain in daylight after 11.5 s');
  check(states[16.9].headline === 'Every interface chooses where the viewer stands.', `closing headline is “${states[16.9].headline}”`);

  await page.evaluate(() => window.studioInterlude.renderAt(8));
  const a1 = hash(await page.screenshot({ type: 'png' }));
  await page.evaluate(() => window.studioInterlude.renderAt(11.5));
  await page.evaluate(() => window.studioInterlude.renderAt(8));
  const a2 = hash(await page.screenshot({ type: 'png' }));
  check(a1 === a2, 'A→B→A deterministic seek produced different pixels');

  await page.evaluate(() => window.studioInterlude.renderAt(14));
  const closingStart = hash(await page.screenshot({ type: 'png' }));
  await page.evaluate(() => window.studioInterlude.renderAt(16.9));
  const closingEnd = hash(await page.screenshot({ type: 'png' }));
  check(closingStart === closingEnd, 'closing is not visually static from 14.0–16.9 s');

  const bounds = await page.evaluate(() => {
    const copy = document.querySelector('.vfs-copy').getBoundingClientRect();
    return { copy: { left: copy.left, right: copy.right, top: copy.top, bottom: copy.bottom } };
  });
  check(bounds.copy.left >= 0 && bounds.copy.right <= 1080 && bounds.copy.top >= 0 && bounds.copy.bottom <= 1350, 'closing copy leaves the 4:5 viewport');

  check(errors.length === 0, errors.join('; '));
  if (failures.length) {
    console.error(`QA FAILED (${failures.length})`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('QA PASSED');
    console.log('- 17.0 s deterministic timeline');
    console.log('- Tokyo crosses the fixed daylight boundary at 11.5 s');
    console.log('- A→B→A seek is pixel-identical');
    console.log('- Closing is pixel-identical from 14.0–16.9 s');
    console.log('- 1080×1350 capture viewport has no overflow');
    console.log('- No external scripts or runtime errors');
  }

  await context.close();
} finally {
  await browser.close();
}
