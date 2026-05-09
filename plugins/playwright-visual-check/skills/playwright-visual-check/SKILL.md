---
name: playwright-visual-check
description: Use when needing to visually inspect web pages — verifying UI implementation, debugging UX issues, checking layout and styling, or any situation where seeing the actual rendered page would help
---

# Playwright Visual Check

## Overview

Use Playwright CLI to capture screenshots of web pages so you can **see** what the user sees. This enables visual verification of UI changes, debugging of layout issues, and validation of rendered content — without writing test files.

**Core principle:** When you need to verify how a page looks, take a screenshot and view it. Don't guess from code alone.

## When to Use

- After implementing or modifying UI components
- When debugging CSS, layout, or styling issues
- When the user reports a visual bug and you need to see it
- To verify a page loads correctly after code changes
- When reviewing responsive design or component rendering
- Any time "seeing" the page would help you make better decisions

## Prerequisites

Before first use, ensure Playwright and its browser are installed:

```powershell
npx playwright install chromium
```

This only needs to be done once per environment. If `npx playwright screenshot` fails with a browser error, run the install command above.

## Quick Reference

| Task | Command |
|------|---------|
| Screenshot a page | `npx playwright screenshot <url> <output.png>` |
| Full-page screenshot | `npx playwright screenshot --full-page <url> <output.png>` |
| Wait for element | `npx playwright screenshot --wait-for-selector "<selector>" <url> <output.png>` |
| Wait for timeout | `npx playwright screenshot --wait-for-timeout <ms> <url> <output.png>` |
| Save login state | `npx playwright open --save-storage auth.json <url>` |
| Use saved login | `npx playwright screenshot --load-storage auth.json <url> <output.png>` |
| View the screenshot | Use the `view` tool on the saved .png file |

## Core Workflow

### 1. Ensure Dev Server Is Running

Before taking screenshots, make sure the development server is running. Check with a quick curl or start it if needed:

```powershell
# Check if already running
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173

# If not running, start it (async, detached)
cd frontend && npm run dev
```

### 2. Take a Screenshot

```powershell
npx playwright screenshot http://localhost:5173 screenshot.png
```

For full-page captures (scrollable content):

```powershell
npx playwright screenshot --full-page http://localhost:5173 screenshot.png
```

Wait for a specific element to appear before capturing:

```powershell
npx playwright screenshot --wait-for-selector ".main-content" http://localhost:5173 screenshot.png
```

### 3. View the Screenshot

Use the `view` tool to see the captured image:

```
view screenshot.png
```

The view tool returns base64-encoded image data that you can analyze visually.

### 4. Clean Up

Delete screenshot files after you're done inspecting them:

```powershell
Remove-Item screenshot.png
```

## Handling Authentication

Many pages require login. Use Playwright's storage state to handle this:

### Save Login State (Interactive — One-Time Setup)

```powershell
npx playwright open --save-storage auth.json http://localhost:5173/login
```

This opens a browser. Log in manually, then close the browser. The auth state is saved to `auth.json`.

### Use Saved Login State

```powershell
npx playwright screenshot --load-storage auth.json http://localhost:5173/ screenshot.png
```

### Auto-Login via Script (Alternative)

If the app uses simple form-based login, you can script it. Create a small Node.js script:

```javascript
// save-auth.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'your-username');
  await page.fill('input[type="password"]', 'your-password');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/');
  await context.storageState({ path: 'auth.json' });
  await browser.close();
})();
```

Run with `node save-auth.js`, then use `--load-storage auth.json` for all subsequent screenshots.

## Multiple Pages / Smoke Check

To quickly verify multiple pages, take screenshots in sequence:

```powershell
$pages = @(
  @{ path = "/"; name = "dashboard" },
  @{ path = "/recipients"; name = "recipients" },
  @{ path = "/history"; name = "history" },
  @{ path = "/templates"; name = "templates" }
)

foreach ($p in $pages) {
  npx playwright screenshot --load-storage auth.json --full-page "http://localhost:5173$($p.path)" "$($p.name).png"
}
```

Then view each screenshot to verify all pages render correctly.

## Tips

- **Use `--wait-for-timeout 2000`** if the page has async data loading — gives 2 seconds for API calls to complete
- **Use `--wait-for-selector`** for pages that load content dynamically — more reliable than timeout
- **Screenshots are PNG by default** — they work well with the `view` tool
- **Save screenshots to a temp directory** to keep the project clean, or delete after inspection
- **Viewport defaults to 1280x720** — use `--viewport-size "1920,1080"` for wider views
- **Use `--device "iPhone 12"`** to check mobile responsive layouts

## Common Issues

| Problem | Solution |
|---------|----------|
| "Browser not found" | Run `npx playwright install chromium` |
| Page shows login screen | Use `--load-storage auth.json` (save state first) |
| Page is blank / loading | Add `--wait-for-timeout 3000` or `--wait-for-selector` |
| Screenshot is too narrow | Add `--viewport-size "1920,1080"` |
| API calls fail (CORS) | Ensure dev server and backend are both running |
