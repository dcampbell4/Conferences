/**
 * Clicks through the Effort Tracker in a real browser (iPad-sized) and saves screenshots.
 * Run with:  node effort-tracker/dev/e2e.js     (needs Playwright installed)
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.PORT = process.env.PORT || '8798';
const server = require('./server');
const BASE = 'http://localhost:' + process.env.PORT;
const SHOTS = process.env.SHOTS || path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  const tile = (name) => page.locator('.tile', { hasText: name }).first();
  const logEntry = async (name, indicator, note) => {
    await tile(name).click();
    await page.waitForSelector('.ind');
    if (note) await page.fill('#note', note);
    await page.click('.ind:has-text("' + indicator + '")');
  };

  // 1. Import classes from Google Classroom on the dashboard
  await page.goto(BASE + '/exec?page=dashboard');
  await page.click('.tab[data-tab="classes"]');
  await page.click('#loadCourses');
  await page.waitForSelector('#importBtn');
  await page.locator('#courses input[type=checkbox]').evaluateAll((els) => els.forEach((e) => { e.checked = true; }));
  await page.click('#importBtn');
  await page.waitForSelector('.class-row');

  // 2. Logging screen
  await page.goto(BASE + '/exec');
  await page.click('.choice:has-text("Grade 9 English - A")');
  await page.waitForSelector('.tile');
  await tile('Bruno L.').click();
  await page.waitForSelector('.ind');
  await page.fill('#note', 'Phone out during task');
  await shot('01-choose-indicator');
  await page.click('.ind:has-text("Engagement")');
  await page.waitForSelector('#undoBar:not(.hidden)');
  await shot('02-logged-with-undo');

  // Undo works
  await page.click('#undoBtn');
  await page.waitForTimeout(400);
  let entries = await (await fetch(BASE + '/debug/sheet?name=Log')).json();
  assert.strictEqual(entries.length, 0);

  // 3. Three entries for Ana -> concern pop-up and email
  await logEntry('Ana S.', 'Respect', 'Rude to partner');
  await page.waitForSelector('#undoBar:not(.hidden)');
  await logEntry('Ana S.', 'Language');
  await page.waitForSelector('#undoBar:not(.hidden)');
  await logEntry('Ana S.', 'Punctuality');
  await page.waitForSelector('text=has reached concern');
  await shot('03-reached-concern');
  await page.click('#sheet [data-act="close"]');
  const mails = await (await fetch(BASE + '/debug/mails')).json();
  assert.strictEqual(mails.length, 1);
  assert.match(mails[0].subject, /Contact home: Ana/);

  // Two entries for Bruno (dots), one for Carla
  await logEntry('Bruno L.', 'Engagement');
  await page.waitForSelector('#undoBar:not(.hidden)');
  await logEntry('Bruno L.', 'Equipment');
  await page.waitForSelector('#undoBar:not(.hidden)');
  await page.waitForTimeout(300);
  await shot('04-log-screen');

  // Hide status (if the screen is visible to students)
  await page.click('#privacyBtn');
  assert.strictEqual(await page.locator('.dots').first().isVisible(), false);
  await page.click('#privacyBtn');

  // 4. Dashboard: needs attention
  await page.goto(BASE + '/exec?page=dashboard');
  await page.waitForSelector('#listContact .person');
  await shot('05-needs-attention');
  await page.click('#listContact [data-follow="contacted"]');
  await page.fill('#fuNote', 'Emailed mother');
  await page.click('#fuSave');
  await page.waitForSelector('#listMonitor .person');

  // 5. Student detail (for conferences)
  await page.click('#listMonitor [data-view]');
  await page.waitForSelector('.rub');
  await shot('06-student-detail');
  await page.click('#sheet [data-close]');

  // 6. All students
  await page.click('.tab[data-tab="students"]');
  await page.waitForSelector('#studentTable tr.clickable');
  await shot('07-all-students');

  // Phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/exec');
  await page.waitForSelector('.tile');
  await shot('08-phone-log');

  await browser.close();
  server.close();
  assert.deepStrictEqual(errors, [], 'browser errors: ' + errors.join('\n'));
  console.log('Browser walk-through passed.');
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
