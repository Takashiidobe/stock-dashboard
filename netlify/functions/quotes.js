const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const MAX_SYMBOLS = 25;

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "FINNHUB_API_KEY is not configured" });
  }

  const symbols = parseSymbols(event.queryStringParameters?.symbols);
  const includeProfile = event.queryStringParameters?.profile === "1";
  if (symbols.length === 0) {
    return jsonResponse(400, { error: "Missing symbols" });
  }

  if (symbols.length > MAX_SYMBOLS) {
    return jsonResponse(400, { error: `Too many symbols; max is ${MAX_SYMBOLS}` });
  }

  try {
    const quotes = await Promise.all(
      symbols.map((symbol) => fetchQuote(symbol, apiKey, includeProfile))
    );
    const bySymbol = {};

    for (const quote of quotes) {
      if (!quote.symbol) continue;

      bySymbol[quote.symbol.toUpperCase()] = {
        latestPrice: quote.latestPrice,
        change: quote.change,
        changePercent: quote.changePercent,
      };

      if (includeProfile) {
        bySymbol[quote.symbol.toUpperCase()].companyName = quote.companyName;
        bySymbol[quote.symbol.toUpperCase()].marketCap = quote.marketCap;
      }
    }

    return jsonResponse(200, bySymbol);
  } catch (error) {
    return jsonResponse(502, {
      error: "Quote provider request failed",
      details: error.message,
    });
  }
};

async function fetchQuote(symbol, apiKey, includeProfile) {
  const quote = await fetchProviderJson("/quote", { symbol, token: apiKey });
  const profile = includeProfile
    ? await fetchProviderJson("/stock/profile2", { symbol, token: apiKey })
    : {};

  return {
    symbol,
    companyName: profile.name || symbol,
    latestPrice: quote.c,
    change: quote.d,
    changePercent: normalizePercent(quote.dp),
    marketCap: normalizeMarketCap(profile.marketCapitalization),
  };
}

async function fetchProviderJson(path, params) {
  const url = new URL(`${FINNHUB_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  const body = await response.text();

  if (!response.ok) {
    const error = new Error("Quote provider request failed");
    error.statusCode = response.status;
    error.details = body;
    throw error;
  }

  return JSON.parse(body);
}

function parseSymbols(value) {
  if (!value) return [];

  return value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.-]+$/.test(symbol))
    .filter((symbol, index, all) => all.indexOf(symbol) === index);
}

function normalizePercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;

  return value / 100;
}

function normalizeMarketCap(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;

  return value * 1000000;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}
