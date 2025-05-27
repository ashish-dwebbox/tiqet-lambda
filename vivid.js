const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const cheerio = require("cheerio");
const addDelay = require('./scraperUtils')
const os = require("os");

const isLambda = false;
const width = 1280;
const height = 720;

let successfullListings = [];

const scraperConfig = {
  platformId: 2,
  listingId: "#row-container",
  scrollContainerSelector: `[data-testid="listings-container"]`,
  screenshotPath: isLambda ? "/tmp/latest.png" : "./latest.png",
  timeout: 60000,
};



const generateJson = async (page, scraperLogger) => {
  await addDelay(5, null, null, scraperLogger);
  const allListings = await page.$$(scraperConfig.listingId);

  for (const div of allListings) {
    try {
      const res = await page.evaluate((el) => el.outerHTML, div);
      const $ = cheerio.load(res);

      const level = $("div div div div div")?.first()?.text()?.trim();
      const section = $("div[role='button']")?.attr("data-sectionid");
      const row = $("div div div div div span")
        ?.first()
        ?.text()
        ?.split("|")[0]
        ?.trim()
        ?.split(" ")[1];

      let quantity = $("div div div div div span")
        ?.first()
        ?.text()
        ?.split("|")[1]
        ?.replace("tickets", "")
        ?.replace("ticket", "")
        ?.trim();

      quantity = quantity?.includes("or")
        ? quantity?.split("or")[1]
        : quantity?.includes("–")
        ? quantity?.split("–")[1]
        : quantity;

      const price = $("div > div:nth-child(3) > div > div:last-child > span")
        ?.first()
        ?.text()
        ?.replace("$", "")
        ?.trim();

      successfullListings.push({ section, row, price, quantity });
    } catch (error) {
      scraperLogger.log("Parse error:", error.message || error);
    }
  }
};

const extractListings = async (page, scraperLogger) => {
  scraperLogger.log("🔍 Extracting listings...");

  await addDelay(5, null, null, scraperLogger);

  const listingsContainer = await page.$(scraperConfig.scrollContainerSelector);
  let previousHeight = 0;
  const startTime = Date.now();

  while (true) {
    const newHeight = await page.evaluate(
      (selector) => document.querySelector(selector)?.scrollHeight,
      scraperConfig.scrollContainerSelector
    );

    scraperLogger.log("📏 Scroll height:", newHeight);

    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      if (container) container.scrollTo(0, container.scrollHeight);
    }, scraperConfig.scrollContainerSelector);

    if (newHeight <= previousHeight || Date.now() - startTime > 8 * 60 * 1000) {
      break;
    }

    previousHeight = newHeight;
    await addDelay(5, null, null, scraperLogger);
  }
};

const beginScraping = async (page, eventUrl, scraperLogger) => {
  await page.goto(eventUrl, {
    waitUntil: "domcontentloaded",
    timeout: scraperConfig.timeout,
  });

  await addDelay(5, null, null, scraperLogger);
  await extractListings(page, scraperLogger);
  await generateJson(page, scraperLogger);
};

const getBrowserConfig = async () => {
  if (isLambda) {
    return {
      headless: chromium.headless,
      executablePath: await chromium.executablePath(),
      args: [...chromium.args, `--window-size=${width},${height}`],
      defaultViewport: { width, height },
      timeout: scraperConfig.timeout,
    };
  } else {
    const puppeteer = require("puppeteer"); // regular puppeteer for local dev
    return {
      headless: false, // easier to debug locally
      executablePath: puppeteer.executablePath(), // local path
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        `--window-size=${width},${height}`,
      ],
      timeout: scraperConfig.timeout,
      defaultViewport: { width, height },
    };
  }
};

const vividseatsMultiScraper = async ({ eventUrl, scraperLogger }) => {
  const puppeteerModule = isLambda
    ? require("puppeteer-core")
    : require("puppeteer");
  const browserConfig = await getBrowserConfig();
  const browser = await puppeteerModule.launch(browserConfig);
  const page = await browser.newPage();

  page.setDefaultTimeout(scraperConfig.timeout);
  page.setDefaultNavigationTimeout(scraperConfig.timeout);

  // error monitoring
  page.on("error", (err) => console.error("[PAGE ERROR]", err));
  page.on("pageerror", (err) => console.error("[BROWSER PAGE ERROR]", err));

  try {
    await beginScraping(page, eventUrl, scraperLogger);

    const uniqueListings = Array.from(
      new Set(successfullListings.map((x) => JSON.stringify(x)))
    ).map((x) => JSON.parse(x));

    if (uniqueListings.length <= 0) {
      throw new Error("No Listings Found");
    }

    return uniqueListings;
  } catch (error) {
    scraperLogger.error("❌ Scraper error:", error.message || error);
    throw error;
  } finally {
    successfullListings = [];
    await page.close();
    await browser.close();
  }
};

exports.handler = async (event) => {
  const eventUrl = event.eventUrl || event.queryStringParameters?.eventUrl;

  const scraperLogger = {
    log: (...args) => console.log("[LOG]", ...args),
    error: (...args) => console.error("[ERROR]", ...args),
  };

  try {
    const result = await vividseatsMultiScraper({ eventUrl, scraperLogger });

    return {
      statusCode: 200,
      body: JSON.stringify(result),
      count: result.length,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ✅ Local run support
if (!isLambda && require.main === module) {
  (async () => {
    const result = await exports.handler({
      eventUrl:
        "https://www.vividseats.com/new-york-knicks-tickets-madison-square-garden-6-3-2025--sports-nba-basketball/production/5561986",
    });
    console.log("🔎 Result:", result.body);
  })();
}
