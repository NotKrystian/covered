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
