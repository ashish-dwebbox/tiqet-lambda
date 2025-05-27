const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

exports.handler = async (event) => {
  const url =
    "https://www.vividseats.com/new-york-knicks-tickets-madison-square-garden-6-3-2025--sports-nba-basketball/production/5561986";

  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page.waitForTimeout(20000); // wait for JS rendering
    const html = await page.content(); // get the entire page HTML
    
    // Optionally try grabbing the title tag
    const title = await page.title();
    

    return {
      statusCode: 200,
      body: JSON.stringify({ title }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
