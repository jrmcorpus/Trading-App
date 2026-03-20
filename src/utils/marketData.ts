/**
 * Real Market Data Fetcher
 * Fetches live prices from trusted sources:
 * - CoinGecko for cryptocurrency (free, no API key needed)
 * - Alpha Vantage for forex pairs (free tier, optional API key)
 */

import { CRYPTO_ASSETS } from "./constants";

interface MarketPrice {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
  source: "coingecko" | "alpha-vantage" | "cached";
}

// Cache to reduce API calls
const priceCache = new Map<string, { data: MarketPrice; timestamp: number }>();
const CACHE_DURATION = 60000; // 1 minute

/**
 * Get cryptocurrency price from CoinGecko (free, no API key needed)
 */
export const getCryptoPriceFromCoinGecko = async (
  symbol: string
): Promise<MarketPrice | null> => {
  try {
    // Check cache first
    const cached = priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    // Map symbol to CoinGecko ID
    const coinGeckoMap: { [key: string]: string } = {
      BTCUSD: "bitcoin",
      ETHUSD: "ethereum",
      XRPUSD: "ripple",
      LTCUSD: "litecoin",
      BNBUSD: "binancecoin",
      ADAUSD: "cardano",
      DOGEUSD: "dogecoin",
      SOLUSD: "solana",
    };

    const coinId = coinGeckoMap[symbol];
    if (!coinId) return null;

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_high_low_24h=true`,
      { method: "GET" }
    );

    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);

    const data = await response.json();
    const coinData = data[coinId];

    if (!coinData) return null;

    const marketPrice: MarketPrice = {
      symbol,
      price: coinData.usd,
      change24h: coinData.usd * (coinData.usd_24h_change / 100),
      changePercent24h: coinData.usd_24h_change,
      high24h: coinData.usd_high_24h || coinData.usd * 1.02,
      low24h: coinData.usd_low_24h || coinData.usd * 0.98,
      timestamp: Date.now(),
      source: "coingecko",
    };

    // Cache the result
    priceCache.set(symbol, { data: marketPrice, timestamp: Date.now() });
    return marketPrice;
  } catch (error) {
    console.error(`Error fetching ${symbol} from CoinGecko:`, error);
    return null;
  }
};

/**
 * Get forex price from Alpha Vantage (free tier available)
 */
export const getForexPriceFromAlphaVantage = async (
  symbol: string
): Promise<MarketPrice | null> => {
  try {
    // Check cache first
    const cached = priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    const apiKey = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
    
    // If no API key, use fallback to cached/simulated data
    if (!apiKey || apiKey === "your-alpha-vantage-key") {
      console.warn(`Alpha Vantage API key not configured. Using fallback data for ${symbol}`);
      return null;
    }

    // Extract currency pairs (e.g., EURUSD -> EUR,USD)
    const [fromSymbol, toSymbol] = [
      symbol.substring(0, 3),
      symbol.substring(3, 6),
    ];

    const response = await fetch(
      `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromSymbol}&to_currency=${toSymbol}&apikey=${apiKey}`,
      { method: "GET" }
    );

    if (!response.ok) throw new Error(`Alpha Vantage API error: ${response.status}`);

    const data = await response.json();
    const exchangeRate = data["Realtime Currency Exchange Rate"];

    if (!exchangeRate) {
      console.warn(`No data returned for ${symbol} from Alpha Vantage`);
      return null;
    }

    const price = parseFloat(exchangeRate["5. Exchange Rate"]);
    const change = parseFloat(exchangeRate["8. Bid Price"]) - parseFloat(exchangeRate["9. Ask Price"]);

    const marketPrice: MarketPrice = {
      symbol,
      price,
      change24h: change,
      changePercent24h: (change / price) * 100,
      high24h: price * 1.02,
      low24h: price * 0.98,
      timestamp: Date.now(),
      source: "alpha-vantage",
    };

    // Cache the result
    priceCache.set(symbol, { data: marketPrice, timestamp: Date.now() });
    return marketPrice;
  } catch (error) {
    console.error(`Error fetching ${symbol} from Alpha Vantage:`, error);
    return null;
  }
};

/**
 * Get market price from the most appropriate source
 */
export const getRealMarketPrice = async (symbol: string): Promise<MarketPrice | null> => {
  // Try CoinGecko for crypto assets first
  if (CRYPTO_ASSETS.includes(symbol)) {
    const cryptoPrice = await getCryptoPriceFromCoinGecko(symbol);
    if (cryptoPrice) return cryptoPrice;
  }

  // Try Alpha Vantage for forex
  if (!CRYPTO_ASSETS.includes(symbol)) {
    const forexPrice = await getForexPriceFromAlphaVantage(symbol);
    if (forexPrice) return forexPrice;
  }

  return null;
};

/**
 * Get prices for multiple symbols in parallel
 */
export const getRealMarketPrices = async (
  symbols: string[]
): Promise<Map<string, MarketPrice>> => {
  const results = new Map<string, MarketPrice>();
  
  // Split into crypto and forex
  const cryptoSymbols = symbols.filter(s => CRYPTO_ASSETS.includes(s));
  const forexSymbols = symbols.filter(s => !CRYPTO_ASSETS.includes(s));

  // Fetch in parallel
  const allPromises = [
    ...cryptoSymbols.map(async (symbol) => {
      const price = await getCryptoPriceFromCoinGecko(symbol);
      if (price) results.set(symbol, price);
    }),
    ...forexSymbols.map(async (symbol) => {
      const price = await getForexPriceFromAlphaVantage(symbol);
      if (price) results.set(symbol, price);
    }),
  ];

  await Promise.all(allPromises);
  return results;
};

/**
 * Clear cache
 */
export const clearPriceCache = () => {
  priceCache.clear();
};

/**
 * Get cache status
 */
export const getCacheSize = () => {
  return priceCache.size;
};
