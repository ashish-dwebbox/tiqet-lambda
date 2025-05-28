const chromium = require("@sparticuz/chromium");
const cheerio = require("cheerio");
const addDelay = require("./scraperUtils");
const os = require("os");

const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { uploadFileToS3 } = require("./s3.utils");


puppeteerExtra.use(StealthPlugin());

const isLambda = !!process.env.AWS_LAMBDA;
const width = 1280;
const height = 720;

const scraperConfig = {
  platformId: 4,
  listingsContainerSelector: "#listingContainer",
  scrollContainerSelector: "#listings",
  headless: os.platform() === "linux",
  screenshortPath: `../multievent-service/output/tickpick/latest.png`,
  timeout: 60000,
};

let successfullListings = [];

//STEP 6
const generateJson = async (page, scraperLogger) => {
  scraperLogger.log("generating json .... , this might take a while");
  const listingsContainer = await page.$(
    scraperConfig.listingsContainerSelector
  );

  if (listingsContainer) {
    const allDivs = await listingsContainer.$$("div");

    // Filter to get only direct child divs
    const directChildDivs = [];
    for (const div of allDivs) {
      const parent = await page.evaluate((el) => el.parentElement?.id, div);
      if (parent === "listingContainer") {
        directChildDivs.push(div);
      }
    }

    for (const [index, div] of directChildDivs.entries()) {
      const html = await page.evaluate((el) => el.outerHTML, div);
      const $ = cheerio.load(html);

      const price = $("div > label > b:first-of-type").html();
      const quantity = $(
        "div > div:nth-of-type(1) >  select > option:first-of-type"
      ).text();
      const secRow = $("div > div:nth-of-type(2) > div:first-of-type > span")
        .text()
        .trim();
      const section = secRow.includes("•")
        ? secRow.split("•")[0].trim()
        : secRow || null;
      const row = secRow.includes("•")
        ? secRow.split("•")[1].replace("Row", "").trim()
        : null;

      // Create JSON object
      let result = {
        price,
        section,
        row,
        quantity,
      };

      result.price = result.price?.replace("$", "") || "";

      if (result.section?.startsWith("Section")) {
        result.section = result.section.split(" ")[1];
      }
      successfullListings.push(result);
    }
    scraperLogger.log("Listing generated successfully");
  } else {
    scraperLogger.log("Listings container not found!");
  }
};

// STEP 5
const extractListings = async (page, scraperLogger) => {
  await addDelay(10, null, null, scraperLogger);

  const scrollToEnd = async () => {
    let previousHeight = await page.evaluate(
      (selector) => document.querySelector(selector)?.scrollHeight,
      scraperConfig.scrollContainerSelector
    );

    while (true) {
      // Scroll within the container
      await page.evaluate((selector) => {
        const container = document.querySelector(selector);
        if (container) {
          container.scrollTo(0, container.scrollHeight);
        }
      }, scraperConfig.scrollContainerSelector);

      // Wait for the content to load

      // Check if the height of the container changed
      const newHeight = await page.evaluate(
        (selector) => document.querySelector(selector)?.scrollHeight,
        scraperConfig.scrollContainerSelector
      );

      if (newHeight === previousHeight) {
        await addDelay(1, "", "", scraperLogger);

        const viewMoreBtn = await page.$("#viewMoreListingsButton");

        if (!viewMoreBtn) {
          scraperLogger.log("Reached the end of the listings.");
          break;
        }

        const isNotHidden = await page.evaluate((selector) => {
          const elem = document.querySelector(selector);
          return (
            elem &&
            window.getComputedStyle(elem).getPropertyValue("display") !== "none"
          );
        }, "#viewMoreListingsButton");

        if (!isNotHidden) {
          scraperLogger.log("Reached the end of the listings.");
          break;
        }

        scraperLogger.log("Fetching more data");

        try {
          await viewMoreBtn.click();
        } catch (error) {
          scraperLogger.error(
            "Error clicking 'View More' button:",
            error.message
          );
          break;
        }
      }

      previousHeight = newHeight;
    }
  };

  // Scroll to the end of the scroll-container
  await scrollToEnd();

  // const listingContainer = await page.$$("#listingContainer");
};

const beginScraping = async (page, eventUrl, scraperLogger) => {
  page.goto(eventUrl, {
    waitUntil: "domcontentloaded",
    timeout: scraperConfig.timeout,
  });

  await addDelay(20, "", "", scraperLogger);

  await extractListings(page, scraperLogger);

  await generateJson(page, scraperLogger);
};
const getBrowserConfig = async () => {
  const baseConfig = {
    args: [
      ...chromium.args,
      `--window-size=${width},${height}`,
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--no-sandbox",

    ],
    defaultViewport: { width, height },
    timeout: scraperConfig.timeout,
  };

  if (isLambda) {
    return {
      ...baseConfig,
      headless: chromium.headless,
      executablePath: await chromium.executablePath(),
    };
  } else {
    const localPuppeteer = require("puppeteer");
    return {
      ...baseConfig,
      headless: false, // Visible browser for local debugging
      executablePath: localPuppeteer.executablePath(),
    };
  }
};

const tickpickMultiScraper = async ({ eventUrl, scraperLogger }) => {
  let browser;
  let page;

  try {
    const browserConfig = await getBrowserConfig();

    browser = await puppeteerExtra.launch(browserConfig);
    page = await browser.newPage();


    await beginScraping(page, eventUrl, scraperLogger);

    if (successfullListings.length <= 0) {
      throw new Error("No Listings Found");
    }

    return [...successfullListings];
  } catch (error) {
    // Take screenshot for debugging
    if (page) {
      await page.screenshot({ path: isLambda ? "/tmp/error.png" : "./error.png" });
      const s3Key = `tickpick.png`;
      await uploadFileToS3({
        localFilePath: "/tmp/error.png",
        s3Key,
      })
    }
    scraperLogger.error(`Error occurred: ${error.message}`);
    throw error;
  } finally {
    successfullListings = [];
    if (page) await page.close().catch(e => console.error(e));
    if (browser) await browser.close().catch(e => console.error(e));
  }
};

exports.handler = async (event) => {
  const eventUrl = event.eventUrl || event.queryStringParameters?.eventUrl;

  const scraperLogger = {
    log: (...args) => console.log("[LOG]", ...args),
    error: (...args) => console.error("[ERROR]", ...args),
  };

  try {
    const result = await tickpickMultiScraper({ eventUrl, scraperLogger });

    return {
      statusCode: 200,
      body: JSON.stringify(result),
      count: result.length,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: err.message,
        details: isLambda ? "Check Lambda logs for more details" : err.stack 
      }),
    };
  }
};

// Local testing
if (!isLambda && require.main === module) {
  (async () => {
    try {
      const result = await exports.handler({
        eventUrl: "https://www.tickpick.com/buy-tickets/6747335/",
      });
      console.log("Scraping result:", result);
    } catch (error) {
      console.error("Local test failed:", error);
    }
  })();
}