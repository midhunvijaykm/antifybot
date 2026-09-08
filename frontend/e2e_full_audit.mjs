import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5173';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMTQ4ZjQ4MTA5MDk1YWYwYTZhOWE2MyIsImlhdCI6MTc4ODgzOTg2MywiZXhwIjoxNzg5NDQ0NjYzfQ.gu1TPc8d7n5MzuGudaj25_8INwGPgfLeH48gZKMQgzY';

const outputDir = path.resolve('output/playwright');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function runAudit() {
  console.log('🚀 Starting Playwright Full-Stack Audit...');
  const browser = await chromium.launch({ headless: true });
  const results = {
    pagesTested: [],
    errorsCaptured: [],
    viewportsTested: [],
    passedFlows: [],
    failedFlows: []
  };

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  // Monitor console errors and unhandled exceptions
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore benign external audio/favicon warnings if any
      if (!text.includes('favicon.ico') && !text.includes('mixkit.co')) {
        results.errorsCaptured.push({ type: 'console.error', text });
        console.error(' [BROWSER CONSOLE ERROR]:', text);
      }
    }
  });

  page.on('pageerror', err => {
    results.errorsCaptured.push({ type: 'pageerror', text: err.message });
    console.error(' [BROWSER UNCAUGHT EXCEPTION]:', err.message);
  });

  try {
    // ----------------------------------------------------
    // TEST 1: Unauthenticated Redirect
    // ----------------------------------------------------
    console.log('\n--- 1. Testing Unauthenticated Route Protection ---');
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(1000);
    const unauthUrl = page.url();
    console.log('Landing redirected URL:', unauthUrl);
    if (unauthUrl.includes('/login')) {
      results.passedFlows.push('Unauthenticated redirect to /login');
      console.log('✅ PASS: Protected route redirects to /login');
    } else {
      results.failedFlows.push('Unauthenticated redirect failed');
      console.error('❌ FAIL: Did not redirect to /login');
    }

    await page.screenshot({ path: path.join(outputDir, '01_login_page.png') });

    // ----------------------------------------------------
    // TEST 2: Authentication Flow via Token
    // ----------------------------------------------------
    console.log('\n--- 2. Testing Authentication & Session Loading ---');
    await page.goto(`${BASE_URL}/login/success?token=${TOKEN}`);
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await page.waitForTimeout(2000);
    console.log('Authenticated URL:', page.url());

    // Check for ErrorBoundary Shield Warning
    const hasShieldWarning = await page.locator('text=Shield Warning').count();
    if (hasShieldWarning > 0) {
      const errDetail = await page.locator('.error-boundary-details').textContent().catch(() => 'Unknown');
      results.failedFlows.push(`Shield Warning caught: ${errDetail}`);
      console.error('❌ FAIL: Shield Warning triggered:', errDetail);
    } else {
      results.passedFlows.push('Authenticated Dashboard loaded with NO ErrorBoundary crash');
      console.log('✅ PASS: Dashboard loaded cleanly without Shield Warning');
    }

    await page.screenshot({ path: path.join(outputDir, '02_dashboard_authenticated.png') });

    // ----------------------------------------------------
    // TEST 3: Navigation across Pages
    // ----------------------------------------------------
    const testPages = [
      { name: 'Dashboard', path: '/dashboard' },
      { name: 'Analytics', path: '/analytics' },
      { name: 'Moderation Center', path: '/moderation' },
      { name: 'Logs', path: '/logs' },
      { name: 'Settings', path: '/settings' },
      { name: 'Premium', path: '/premium' },
      { name: 'Usage Limits', path: '/usage' }
    ];

    console.log('\n--- 3. Testing Major Page Navigation & Renders ---');
    for (const p of testPages) {
      console.log(`Navigating to ${p.name} (${p.path})...`);
      await page.goto(`${BASE_URL}${p.path}`);
      await page.waitForTimeout(1500);

      const isCrashed = await page.locator('text=Shield Warning').count();
      if (isCrashed > 0) {
        console.error(`❌ FAIL: ${p.name} crashed with Shield Warning!`);
        results.failedFlows.push(`${p.name} crashed`);
      } else {
        console.log(`✅ PASS: ${p.name} rendered without error`);
        results.passedFlows.push(`${p.name} rendered cleanly`);
      }

      const filename = `03_page_${p.name.toLowerCase().replace(/\s+/g, '_')}.png`;
      await page.screenshot({ path: path.join(outputDir, filename) });
      results.pagesTested.push(p.name);
    }

    // ----------------------------------------------------
    // TEST 4: Moderation Operations Sub-Tabs
    // ----------------------------------------------------
    console.log('\n--- 4. Testing Moderation Center Interactive Tabs ---');
    await page.goto(`${BASE_URL}/moderation`);
    await page.waitForTimeout(1500);

    const modTabs = [
      'Recent Actions',
      'HistoryScan Results',
      'Evidence Viewer',
      'Appeals Panel',
      'False Positive Review',
      'Audit Logs'
    ];

    for (const tabText of modTabs) {
      const tabButton = page.locator(`button:has-text("${tabText}")`).first();
      if (await tabButton.count() > 0) {
        await tabButton.click();
        await page.waitForTimeout(800);
        const tabCrashed = await page.locator('text=Shield Warning').count();
        if (tabCrashed > 0) {
          console.error(`❌ FAIL: Moderation tab "${tabText}" crashed!`);
          results.failedFlows.push(`Moderation Tab: ${tabText} crashed`);
        } else {
          console.log(`✅ PASS: Moderation tab "${tabText}" active and intact`);
          results.passedFlows.push(`Moderation Tab: ${tabText}`);
        }
      }
    }
    await page.screenshot({ path: path.join(outputDir, '04_moderation_tabs.png') });

    // ----------------------------------------------------
    // TEST 5: TopNav Interactive Elements
    // ----------------------------------------------------
    console.log('\n--- 5. Testing TopNav Dropdowns & Interactivity ---');
    const guildSelectorBtn = page.locator('.guild-selector-btn');
    if (await guildSelectorBtn.count() > 0) {
      await guildSelectorBtn.click();
      await page.waitForTimeout(500);
      const isDropdownOpen = await page.locator('.guild-dropdown').isVisible();
      console.log(`Guild dropdown visible: ${isDropdownOpen}`);
      if (isDropdownOpen) {
        results.passedFlows.push('TopNav Guild Selector Dropdown toggles');
      }
      await guildSelectorBtn.click(); // close
    }

    // ----------------------------------------------------
    // TEST 6: Responsive Viewports (Desktop, Tablet, Mobile)
    // ----------------------------------------------------
    console.log('\n--- 6. Testing Responsive Viewports ---');
    const viewports = [
      { name: 'Desktop (1920x1080)', width: 1920, height: 1080 },
      { name: 'Tablet (768x1024)', width: 768, height: 1024 },
      { name: 'Mobile (390x844)', width: 390, height: 844 }
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForTimeout(1000);

      // Check horizontal overflow
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      console.log(`${vp.name}: Horizontal overflow detected: ${hasHorizontalScroll}`);
      if (!hasHorizontalScroll) {
        results.passedFlows.push(`Responsive layout clean on ${vp.name}`);
      } else {
        console.warn(`⚠️ Warning: Horizontal scroll on ${vp.name}`);
      }

      const vpFilename = `05_viewport_${vp.name.split(' ')[0].toLowerCase()}.png`;
      await page.screenshot({ path: path.join(outputDir, vpFilename) });
      results.viewportsTested.push(vp.name);
    }

  } catch (err) {
    console.error('Audit execution error:', err);
    results.failedFlows.push(`Execution error: ${err.message}`);
  } finally {
    await browser.close();
  }

  // Summary Report
  console.log('\n========================================');
  console.log('AUDIT SUMMARY');
  console.log('========================================');
  console.log(`Total Pages Tested: ${results.pagesTested.length}`);
  console.log(`Total Flows Passed: ${results.passedFlows.length}`);
  console.log(`Total Flows Failed: ${results.failedFlows.length}`);
  console.log(`Console / Page Errors: ${results.errorsCaptured.length}`);
  console.log('========================================\n');

  fs.writeFileSync(
    path.join(outputDir, 'audit_results.json'),
    JSON.stringify(results, null, 2)
  );

  return results;
}

runAudit().then(res => {
  if (res.failedFlows.length > 0) {
    process.exit(1);
  }
  process.exit(0);
});
