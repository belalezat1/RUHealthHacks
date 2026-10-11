import { chromium } from '../../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
const browser = await chromium.launch({executablePath:'/Users/b/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1050},deviceScaleFactor:2});
await page.setContent('<html><head><style>html,body{margin:0;width:1800px;height:1050px}</style></head><body>'+await fs.readFile(new URL('./relay-architecture.svg',import.meta.url),'utf8')+'</body></html>');
await page.screenshot({path:new URL('./relay-architecture.png',import.meta.url).pathname});
await browser.close();
