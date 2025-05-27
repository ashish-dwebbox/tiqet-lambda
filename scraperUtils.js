const addDelay = async (delaySec, page, path, scraperLogger) => {
    if (page && path) {
      await page.screenshot({ path });
    }
  
    (scraperLogger || console).log(`⏳ Waiting for ${delaySec} seconds...`);
    return new Promise((resolve) =>
      setTimeout(() => {
        (scraperLogger || console).log(`✅ Wait complete`);
        resolve(true);
      }, delaySec * 1000)
    );
  };

module.exports = addDelay