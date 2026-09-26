const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function runExtract(document, href = "https://www.google.com/search?q=tv&udm=28") {
  const code = fs.readFileSync(path.join(__dirname, "extract.js"), "utf8");
  const context = {
    document,
    location: { href },
    URL,
    Array,
    Number,
    String,
    console,
  };
  vm.runInNewContext(`${code}\nthis.result = extractGrid();`, context);
  return context.result;
}

function emptyDocument() {
  return {
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

test("extractGrid returns empty lists on an empty document", () => {
  const result = runExtract(emptyDocument());
  assert.equal(result.sponsored.length, 0);
  assert.equal(result.browse.length, 0);
  assert.equal(result.hits.sponsored.units, 0);
  assert.equal(result.hits.browse.units, 0);
});

test("extractGrid maps a sponsored PLA unit and unwraps /aclk", () => {
  const unit = {
    getAttribute: (name) => {
      if (name === "data-pla-slot-pos") return "1";
      if (name === "data-dtld") return "currys.co.uk";
      if (name === "data-offer-id") return "offer-1";
      return null;
    },
    querySelector: (selector) => {
      if (selector === '[role="heading"] div') return { textContent: "Samsung 85 inch TV" };
      if (selector === ".VbBaOe") return { textContent: "£1,299.00" };
      if (selector === ".UsGWMe") return { textContent: "Currys" };
      if (selector === "a.plantl.clickable-card") {
        return { getAttribute: (n) => (n === "href" ? "/aclk?adurl=https%3A%2F%2Fwww.currys.co.uk%2Ftv" : null) };
      }
      return null;
    },
    querySelectorAll: () => [],
    textContent: "Samsung 85 inch TV £1,299.00 Currys",
  };
  const document = {
    querySelectorAll: (selector) => {
      if (selector === "div.ArOTm.top-pla-group-inner div.mnr-c.pla-unit") return [unit];
      return [];
    },
    querySelector: () => null,
  };
  const result = runExtract(document);
  assert.equal(result.sponsored.length, 1);
  const offer = result.sponsored[0];
  assert.equal(offer.section, "sponsored");
  assert.equal(offer.title, "Samsung 85 inch TV");
  assert.equal(offer.price, "£1,299.00");
  assert.equal(offer.merchant, "Currys");
  assert.equal(offer.merchant_domain, "currys.co.uk");
  assert.equal(offer.product_url, "https://www.currys.co.uk/tv");
});

test("extractGrid reads the displayed img src as image_url", () => {
  const img = {
    currentSrc: "https://encrypted-tbn0.gstatic.com/images?q=tbn:test",
    src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:test",
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    width: 0,
    getAttribute: (n) => (n === "src" ? "https://encrypted-tbn0.gstatic.com/images?q=tbn:test" : null),
  };
  const unit = {
    getAttribute: (name) => {
      if (name === "data-offer-id") return "offer-img";
      if (name === "data-dtld") return "currys.co.uk";
      return null;
    },
    querySelector: (selector) => {
      if (selector === '[role="heading"] div') return { textContent: "TV" };
      if (selector === ".VbBaOe") return { textContent: "£10.00" };
      if (selector === ".UsGWMe") return { textContent: "Currys" };
      return null;
    },
    querySelectorAll: (selector) => (selector === "img" ? [img] : []),
    textContent: "TV £10.00 Currys",
  };
  const document = {
    querySelectorAll: (selector) => {
      if (selector === "div.ArOTm.top-pla-group-inner div.mnr-c.pla-unit") return [unit];
      return [];
    },
    querySelector: () => null,
    createElement: () => {
      throw new Error("canvas should not run when the img is not loaded");
    },
  };
  const result = runExtract(document);
  assert.equal(result.sponsored[0].image_url, "https://encrypted-tbn0.gstatic.com/images?q=tbn:test");
  assert.equal(result.sponsored[0].image_data_url, undefined);
});

test("extractGrid unwraps a browse /goto shop href", () => {
  const row = {
    getAttribute: (name) => (name === "aria-label" ? "" : null),
    querySelector: (selector) => {
      if (selector === ".gkQHve") return { textContent: "Black fleece" };
      if (selector === ".lmQWe") return { textContent: "£22.00", getAttribute: () => null };
      if (selector === ".WJMUdc") return { textContent: "JD Sports" };
      if (selector === "a.plantl.clickable-card" || selector === "a.plantl") {
        return { getAttribute: (n) => (n === "href" ? "/goto?url=https%3A%2F%2Fwww.jdsports.co.uk%2Fproduct%2Ffleece" : null) };
      }
      return null;
    },
    querySelectorAll: () => [],
    textContent: "Black fleece £22.00 JD Sports",
  };
  const document = {
    querySelectorAll: (selector) => {
      if (selector === "product-viewer-group ul product-viewer-entrypoint") return [row];
      return [];
    },
    querySelector: () => null,
  };
  const result = runExtract(document);
  assert.equal(result.browse.length, 1);
  assert.equal(result.browse[0].product_url, "https://www.jdsports.co.uk/product/fleece");
});

test("extractGrid classifies a monthly contract from the price and title", () => {
  const unit = {
    getAttribute: (name) => {
      if (name === "data-offer-id") return "mo-1";
      if (name === "data-dtld") return "ee.co.uk";
      return null;
    },
    querySelector: (selector) => {
      if (selector === '[role="heading"] div') return { textContent: "iPhone 16 24 months" };
      if (selector === ".VbBaOe") return { textContent: "£30/month" };
      if (selector === ".UsGWMe") return { textContent: "EE" };
      return null;
    },
    querySelectorAll: () => [],
    textContent: "iPhone 16 24 months £30/month EE",
  };
  const document = {
    querySelectorAll: (selector) => {
      if (selector === "div.ArOTm.top-pla-group-inner div.mnr-c.pla-unit") return [unit];
      return [];
    },
    querySelector: () => null,
  };
  const result = runExtract(document);
  assert.equal(result.sponsored.length, 1);
  const offer = result.sponsored[0];
  assert.equal(offer.price_kind, "monthly");
  assert.equal(offer.monthly_pence, 3000);
  assert.equal(offer.term_months, 24);
  assert.equal(offer.price, "£30/month");
});
