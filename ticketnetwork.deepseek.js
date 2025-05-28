const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const cheerio = require("cheerio");
const addDelay = require('./scraperUtils');
const os = require("os");

const isLambda = false;
const width = 1280;
const height = 720;

let successfullListings = [];

const scraperConfig = {
  platformId: 3,
  scrollContainerSelector: "#venue-ticket-list",
  headless: os.platform() === "linux",
  screenshortPath: isLambda ? "/tmp/latest.png" : "../multievent-service/output/ticketnetwork/latest.png",
  timeout: 60000,
};

const generateJson = async (page, scraperLogger) => {
  const allDivs = await page.$$("#content-area>tr");

  for (const div of allDivs) {
    try {
      const html = await page.evaluate((el) => el.outerHTML, div);
      const $ = cheerio.load(html);

      const row = $("tr");
      const ticketRow = row.find("td:nth-child(1) span:nth-child(1)").text();

      let sectionText = `${ticketRow?.split(" ")[0]} ${
        ticketRow?.split(" ")[1]
      } ${ticketRow?.split(" ")[2] ? ticketRow?.split(" ")[2] : null} ${
        ticketRow?.split(" ")[3] && ticketRow?.split(" ")[3] !== "•"
          ? ticketRow?.split(" ")[3]
          : ""
      }`.trim();

      sectionText = sectionText
        .split(" ")
        [sectionText.split(" ").length - 1]?.trim();

      const rowText = row
        .find("td div span:nth(2)")
        .html()
        ?.split(" ")[1]
        ?.trim();

      let quantityText = row
        .find("td:nth-child(1) span:nth-child(4) span")
        .html()
        ?.split("</span>")[1]
        ?.replace("Tickets", "")
        ?.trim();

      quantityText = quantityText?.includes("or")
        ? quantityText.split("or")[1]
        : quantityText?.includes("-")
        ? quantityText.split("-")[1]
        : quantityText?.replace("Ticket", "").trim();

      if (quantityText?.includes("Ticket Packages")) {
        quantityText.replace("Ticket Packages", "");
      }
      quantityText = quantityText?.trim();

      const priceText = row
        .find("td:nth-child(3) span:nth-child(2) ")
        .html()
        ?.replace("$", "")
        ?.trim();

      if (priceText) {
        successfullListings.push({
          section: sectionText,
          row: rowText,
          quantity: quantityText,
          price: priceText,
        });
      }
    } catch (error) {
      scraperLogger.log("Parse error:", error.message || error);
    }
  }
};

const extractListings = async (page, scraperLogger) => {
  scraperLogger.log("🔍 Extracting TicketNetwork listings...");

  await page.waitForSelector(scraperConfig.scrollContainerSelector);
  let previousHeight = 0;
  const startTime = Date.now();

  while (true) {
    await generateJson(page, scraperLogger);
    
    const newHeight = await page.evaluate(
      (selector) => document.querySelector(selector)?.scrollHeight,
      scraperConfig.scrollContainerSelector
    );

    scraperLogger.log("📏 Scroll height:", newHeight);

    await page.evaluate(
      (selector, scrollAmount) => {
        const container = document.querySelector(selector);
        if (container) container.scrollTo(0, scrollAmount);
      },
      scraperConfig.scrollContainerSelector,
      previousHeight + 2000
    );

    if (newHeight <= previousHeight) {
      break;
    }

    previousHeight += 2000;
    await addDelay(5, null, null, scraperLogger);
  }
};

const beginScraping = async (page, eventUrl, scraperLogger) => {
  await page.goto(eventUrl, {
    waitUntil: "domcontentloaded",
    timeout: scraperConfig.timeout,
  });

  await addDelay(10, null, null, scraperLogger);
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
      headless: scraperConfig.headless,
      executablePath: puppeteer.executablePath(),
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

const ticketnetworkMultiScraper = async ({ eventUrl, scraperLogger }) => {
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
    const result = await ticketnetworkMultiScraper({ eventUrl, scraperLogger });

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
      eventUrl: "https://www.ticketnetwork.com/tickets/6983223/nba-eastern-conference-finals-new-york-knicks-vs-indiana-pacers-home-game-4-series-game-7-if-necessary-tickets-mon-jun-2-2025-madison-square-garden",
    });
    console.log("🔎 Result:", result);
  })();
}