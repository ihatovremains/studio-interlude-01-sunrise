import { chromium } from '/Users/takaakisuzuki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';
import sharp from '/Users/takaakisuzuki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const source = process.argv[2] || path.join(root, 'index.html');
const outputDir = path.join(root, 'assets', 'keyframes');
const frames = [
  { name: 'frame-01.png', time: 1.5 },
  { name: 'frame-02.png', time: 4.5 },
  { name: 'frame-03.png', time: 8.0 },
  { name: 'frame-04.png', time: 11.5 },
  { name: 'frame-05.png', time: 15.5 }
];

await mkdir(outputDir, { recursive: true });

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
  await page.goto(`${pathToFileURL(source).href}?capture=1`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => typeof window.studioInterlude?.renderAt === 'function');

  for (const item of frames) {
    await page.evaluate((time) => window.studioInterlude.renderAt(time), item.time);
    await page.screenshot({
      path: path.join(outputDir, item.name),
      type: 'png',
      fullPage: false
    });
  }

  await context.close();
} finally {
  await browser.close();
}

const thumbs = await Promise.all(frames.map(async (item) => ({
  input: await sharp(path.join(outputDir, item.name)).resize(360, 450).png().toBuffer(),
  left: (frames.indexOf(item) % 3) * 360,
  top: Math.floor(frames.indexOf(item) / 3) * 450
})));

await sharp({
  create: {
    width: 1080,
    height: 900,
    channels: 4,
    background: { r: 240, g: 240, b: 240, alpha: 1 }
  }
}).composite(thumbs).png().toFile(path.join(outputDir, 'contact-sheet.png'));
