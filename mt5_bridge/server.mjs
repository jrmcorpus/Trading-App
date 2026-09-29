import http from "node:http";
import { spawn, execSync } from "node:child_process";
import { URL } from "node:url";
import path from "node:path";
import process from "node:process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHeadlessTrader } from "./headlessTrader.mjs";

const loadEnvFromFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;

    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

const cwd = process.cwd();
loadEnvFromFile(path.resolve(cwd, ".env.local"));

const PORT = Number(process.env.MT5_BRIDGE_PORT || 8787);
const PYTHON_BIN = process.env.MT5_BRIDGE_PYTHON || "python";
const scriptPath = path.resolve(process.cwd(), "mt5_bridge", "fetch_mt5_rates.py");
const mt5AdapterPath = path.resolve(process.cwd(), "mt5_bridge", "mt5_adapter.py");
const MT5_NATIVE_MODE = String(process.env.MT5_BRIDGE_MODE || "native").trim().toLowerCase() === "native";
const MT5_TRADING_ENABLED = ["1", "true", "yes", "on", "enabled"].includes(
  String(process.env.MT5_TRADING_ENABLED || "false").trim().toLowerCase()
);
const HEADLESS_CONFIG_PATH =
  process.env.MT4_HEADLESS_CONFIG_FILE || path.resolve(process.cwd(), "mt5_bridge", "headless-config.json");

const MT4_FILES_DIR = process.env.MT4_BRIDGE_FILES_DIR || path.resolve(process.cwd(), "mt5_bridge", "mt4_data");
const MT4_FILE_PREFIX = process.env.MT4_BRIDGE_FILE_PREFIX || "";
const MT4_COMMAND_FILE = process.env.MT4_BRIDGE_COMMAND_FILE || "bridge_command.csv";
const MT4_RESULT_FILE = process.env.MT4_BRIDGE_RESULT_FILE || "bridge_result.csv";
const MT4_POSITIONS_FILE = process.env.MT4_BRIDGE_POSITIONS_FILE || "bridge_positions.csv";
const MT4_ACCOUNT_FILE = process.env.MT4_BRIDGE_ACCOUNT_FILE || "bridge_account.csv";
const MT4_HISTORY_FILE = process.env.MT4_BRIDGE_HISTORY_FILE || "bridge_history.csv";
const MT4_TICKS_FILE = process.env.MT4_BRIDGE_TICKS_FILE || "bridge_ticks.csv";
const MT4_POLICY_FILE = process.env.MT4_BRIDGE_POLICY_FILE || "bridge_policy.csv";
const MT4_SYMBOLS_FILE = process.env.MT4_BRIDGE_SYMBOLS_FILE || "bridge_symbols.csv";

const MT4_CONFIRM_TTL_MS = Number(process.env.MT4_CONFIRM_TTL_MS || 60000);
const MT4_EXEC_TIMEOUT_MS = Number(process.env.MT4_EXEC_TIMEOUT_MS || 20000);
const MT4_MAX_LOT_PER_ORDER = Number(process.env.MT4_MAX_LOT_PER_ORDER || 5);
const MT4_REQUIRE_SL_TP = String(process.env.MT4_REQUIRE_SL_TP || "true").toLowerCase() !== "false";
const MT4_MAX_OPEN_TRADES = Number(process.env.MT4_MAX_OPEN_TRADES || 5);
const MT4_MAX_OPEN_PER_SYMBOL = Number(process.env.MT4_MAX_OPEN_PER_SYMBOL || 1);
const MT4_MIN_RR = Number(process.env.MT4_MIN_RR || 1.5);
const MT4_SYMBOL_COOLDOWN_SEC = Number(process.env.MT4_SYMBOL_COOLDOWN_SEC || 300);
const MT4_DAILY_LOSS_LIMIT_PCT = Number(process.env.MT4_DAILY_LOSS_LIMIT_PCT || 3);
const MT4_ALLOWED_SYMBOLS = String(process.env.MT4_ALLOWED_SYMBOLS || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const TWELVE_DATA_API_KEY =
  String(process.env.TWELVE_DATA_API_KEY || process.env.VITE_TWELVE_DATA_API_KEY || "").trim();
const ALPHA_VANTAGE_API_KEY =
  String(process.env.ALPHA_VANTAGE_API_KEY || process.env.VITE_ALPHA_VANTAGE_API_KEY || "").trim();
const GEMINI_API_KEY =
  String(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "").trim();
const GEMINI_MODEL =
  String(process.env.GEMINI_MODEL || process.env.VITE_GEMINI_MODEL || "gemini-2.5-flash").trim();
const OPENAI_API_KEY =
  String(process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || "").trim();
const OPENAI_MODEL =
  String(process.env.OPENAI_MODEL || process.env.VITE_OPENAI_MODEL || "gpt-4o-mini").trim();
const BRIDGE_VERSION = String(process.env.MT4_BRIDGE_VERSION || "2026.03.07-market-intel").trim();
const BRIDGE_CAPABILITIES = [
  "orders-prepare-confirm",
  "policy-check",
  "market-intel",
  "ai-complete",
  "fallback-candles",
  "symbols",
  "ticks",
  "history",
  "policy-events",
  "headless-autotrade",
];

const pendingOrders = new Map();
const mt4ResolvedFileCache = new Map();
const mt4ParsedFileCache = new Map();

const readFileWithRetry = async (fullPath, attempts = 5, delayMs = 60) => {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fsPromises.readFile(fullPath, "utf8");
    } catch (err) {
      lastErr = err;
      const code = err?.code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") {
        throw err;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
};

const parseJsonBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
      if (raw.length > 1_000_000) {
        resolve({});
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });

const runFetcher = ({ symbol, timeframe, count }) =>
  new Promise((resolve) => {
    const args = [scriptPath, "--symbol", symbol, "--timeframe", timeframe, "--count", String(count)];
    const child = spawn(PYTHON_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr || stdout || `Python exited with code ${code}` });
        return;
      }

      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (err) {
        resolve({ ok: false, error: `Invalid JSON from MT5 fetcher: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  });

const runMt5Adapter = ({ action, ...payload }) =>
  new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [mt5AdapterPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: `MT5 adapter process failed: ${err.message}` });
    });

    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout || "{}");
        if (parsed && typeof parsed === "object") {
          resolve(parsed);
          return;
        }
      } catch {
        // Return a sanitized process-boundary error below.
      }
      resolve({ ok: false, error: stderr.trim() || "MT5 adapter returned invalid JSON" });
    });

    child.stdin.end(JSON.stringify({ action, ...payload }));
  });

const mt4SymbolCandidates = (symbol) => {
  const raw = String(symbol || "").toUpperCase().replace("/", "");
  if (raw === "GOLD") {
    return ["XAUUSD", "GOLD", "GOLDm", "GOLD#", "GOLDm#", "XAUUSDm", "XAUUSD.", "XAUUSD#", "XAUUSDm#"];
  }
  if (raw === "CRUDEOIL") return ["USOIL", "XTIUSD", "WTIUSD", "OIL", "USOILm", "USOIL#"];
  if (/^[A-Z]{6}$/.test(raw)) {
    return [raw, `${raw}m`, `${raw}.`, `${raw}pro`, `${raw}#`, `${raw}m#`, `${raw}.#`];
  }
  return [raw];
};

const normalizeBrokerSymbol = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const tfBucketSec = (tf) => {
  switch (String(tf || "").toUpperCase()) {
    case "M1":
      return 60;
    case "M5":
      return 300;
    case "M15":
      return 900;
    case "M30":
      return 1800;
    case "H1":
      return 3600;
    case "H4":
      return 14400;
    case "D1":
      return 86400;
    case "W1":
      return 604800;
    case "MN":
      return 2592000;
    default:
      return 60;
  }
};

const tfMultiplierFromM1 = (tf) => Math.max(1, Math.floor(tfBucketSec(tf) / 60));

const aggregateCandlesFromM1 = (candles, targetTf, count) => {
  const bucketSec = tfBucketSec(targetTf);
  if (bucketSec <= 60) return candles.slice(-Math.max(50, Math.min(2000, count)));
  const byBucket = new Map();

  for (const candle of candles) {
    const bucket = Math.floor(Number(candle.time) / bucketSec) * bucketSec;
    const existing = byBucket.get(bucket);
    if (!existing) {
      byBucket.set(bucket, { ...candle, time: bucket });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += Number(candle.volume || 0);
  }

  return Array.from(byBucket.values())
    .sort((a, b) => a.time - b.time)
    .slice(-Math.max(50, Math.min(2000, count)));
};

const parseMt4CsvCached = async (fullPath) => {
  const stat = await fsPromises.stat(fullPath);
  const cacheHit = mt4ParsedFileCache.get(fullPath);
  if (cacheHit && cacheHit.mtimeMs === stat.mtimeMs && cacheHit.size === stat.size) {
    return cacheHit.candles;
  }

  const content = await readFileWithRetry(fullPath);
  const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candles = [];

  for (const row of rows) {
    const cols = row.includes(",") ? row.split(",") : row.split(";");
    if (cols.length < 5) continue;

    const time = Number(cols[0]);
    const open = Number(cols[1]);
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    const volume = Number(cols[5] || 0);

    if (Number.isFinite(time) && Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close)) {
      candles.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
    }
  }

  mt4ParsedFileCache.set(fullPath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    candles,
  });
  return candles;
};

const findMt4FileBySymbol = async (symbolCandidates, tf) => {
  const cacheKey = `${symbolCandidates[0] || ""}|${tf}`;
  const cached = mt4ResolvedFileCache.get(cacheKey);
  if (cached?.fullPath && fs.existsSync(cached.fullPath)) {
    return { resolvedSymbol: cached.resolvedSymbol, fullPath: cached.fullPath };
  }

  for (const candidate of symbolCandidates) {
    const filename = `${MT4_FILE_PREFIX}${candidate}_${tf}.csv`;
    const fullPath = path.join(MT4_FILES_DIR, filename);
    if (fs.existsSync(fullPath)) {
      const match = { resolvedSymbol: candidate, fullPath };
      mt4ResolvedFileCache.set(cacheKey, match);
      return match;
    }
  }

  let entries = [];
  try {
    entries = await fsPromises.readdir(MT4_FILES_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const targetSet = new Set(symbolCandidates.map((candidate) => normalizeBrokerSymbol(candidate)));
  const targetRaw = normalizeBrokerSymbol(symbolCandidates[0] || "");
  const suffix = `_${tf}.csv`;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.toUpperCase().endsWith(suffix)) continue;

    const fileStem = name.slice(0, -suffix.length);
    const symbolPart = fileStem.startsWith(MT4_FILE_PREFIX) ? fileStem.slice(MT4_FILE_PREFIX.length) : fileStem;
    const normalized = normalizeBrokerSymbol(symbolPart);
    if (!normalized) continue;

    const isDirectMatch = targetSet.has(normalized);
    const isPrefixedMatch = targetRaw && normalized.startsWith(targetRaw);
    if (!isDirectMatch && !isPrefixedMatch) continue;

    try {
      const fullPath = path.join(MT4_FILES_DIR, name);
      const match = { resolvedSymbol: symbolPart, fullPath };
      mt4ResolvedFileCache.set(cacheKey, match);
      return match;
    } catch {
      // continue
    }
  }

  return null;
};

const readMt4Candles = async ({ symbol, timeframe, count }) => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({
      action: "candles",
      symbol,
      timeframe: String(timeframe || "D1").toUpperCase(),
      count: Number.isFinite(count) ? count : 300,
    });
  }

  try {
    const tf = String(timeframe || "D1").toUpperCase();
    const resolvedExecutable = await resolveExecutableSymbol(symbol);
    const preferredSymbol = resolvedExecutable.ok && resolvedExecutable.symbol ? resolvedExecutable.symbol : symbol;
    const candidates = Array.from(new Set([
      String(preferredSymbol || "").trim().toUpperCase(),
      ...mt4SymbolCandidates(symbol),
    ].filter(Boolean)));
    const match = await findMt4FileBySymbol(candidates, tf);
    const fullPath = match?.fullPath ?? null;
    const resolvedSymbol = match?.resolvedSymbol ?? null;

    if (!fullPath || !resolvedSymbol) {
      if (tf !== "M1") {
        const m1Count = Math.min(20000, Math.max(500, Number(count || 300) * tfMultiplierFromM1(tf)));
        const m1 = await readMt4Candles({ symbol, timeframe: "M1", count: m1Count });
        if (m1.ok && Array.isArray(m1.candles) && m1.candles.length) {
          const aggregated = aggregateCandlesFromM1(m1.candles, tf, Number.isFinite(count) ? count : 300);
          if (aggregated.length) {
            return {
              ok: true,
              source: "MT4",
              symbol: m1.symbol || resolvedSymbol || symbol,
              requested_symbol: symbol,
              timeframe: tf,
              candles: aggregated,
              derived_from: "M1",
            };
          }
        }
      }
      return { ok: false, error: `MT4 data file not found for ${symbol} ${tf}. Expected in ${MT4_FILES_DIR}` };
    }
    const candles = await parseMt4CsvCached(fullPath);

    if (!candles.length) {
      return { ok: false, error: `MT4 file found but no valid candles for ${symbol} ${tf}` };
    }

    return {
      ok: true,
      source: "MT4",
      symbol: resolvedSymbol,
      requested_symbol: symbol,
      timeframe: tf,
      candles: candles.slice(-Math.max(50, Math.min(2000, count))),
    };
  } catch (err) {
    return {
      ok: false,
      error: `MT4 candle read failed for ${symbol} ${timeframe}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

const cleanCsvToken = (value) => String(value ?? "").replace(/[\r\n,;]/g, " ").trim();

const buildCommandLine = (request) => {
  if (request.action === "PLACE") {
    return [
      request.id,
      "PLACE",
      cleanCsvToken(request.symbol),
      cleanCsvToken(request.side),
      Number(request.lots).toString(),
      request.sl ? Number(request.sl).toString() : "",
      request.tp ? Number(request.tp).toString() : "",
      String(request.deviation ?? 20),
      cleanCsvToken(request.comment ?? "web-bridge"),
    ].join(",");
  }

  if (request.action === "PENDING") {
    return [
      request.id,
      "PENDING",
      cleanCsvToken(request.symbol),
      cleanCsvToken(request.orderType),
      Number(request.lots).toString(),
      Number(request.price).toString(),
      request.sl ? Number(request.sl).toString() : "",
      request.tp ? Number(request.tp).toString() : "",
      String(request.deviation ?? 20),
      cleanCsvToken(request.comment ?? "web-bridge"),
    ].join(",");
  }

  if (request.action === "CLOSE") {
    return [
      request.id,
      "CLOSE",
      String(request.ticket),
      request.lots ? Number(request.lots).toString() : "",
      String(request.deviation ?? 20),
    ].join(",");
  }

  return [
    request.id,
    "MODIFY",
    String(request.ticket),
    request.sl ? Number(request.sl).toString() : "",
    request.tp ? Number(request.tp).toString() : "",
  ].join(",");
};

const commandPath = () => path.join(MT4_FILES_DIR, MT4_COMMAND_FILE);
const resultPath = () => path.join(MT4_FILES_DIR, MT4_RESULT_FILE);
const positionsPath = () => path.join(MT4_FILES_DIR, MT4_POSITIONS_FILE);
const accountPath = () => path.join(MT4_FILES_DIR, MT4_ACCOUNT_FILE);
const historyPath = () => path.join(MT4_FILES_DIR, MT4_HISTORY_FILE);
const ticksPath = () => path.join(MT4_FILES_DIR, MT4_TICKS_FILE);
const policyPath = () => path.join(MT4_FILES_DIR, MT4_POLICY_FILE);
const symbolsPath = () => path.join(MT4_FILES_DIR, MT4_SYMBOLS_FILE);

const ensureMt4Dir = async () => {
  if (!fs.existsSync(MT4_FILES_DIR)) {
    throw new Error(`MT4 files directory does not exist: ${MT4_FILES_DIR}`);
  }
};

const waitForResult = async (requestId, timeoutMs) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (fs.existsSync(resultPath())) {
        const content = await fsPromises.readFile(resultPath(), "utf8");
        const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const matching = rows.find((line) => line.startsWith(`${requestId},`));

        if (matching) {
          const cols = matching.split(",");
          return {
            ok: cols[1] === "OK",
            requestId,
            status: cols[1] || "ERR",
            message: cols[2] || "",
            ticket: cols[3] ? Number(cols[3]) : null,
            price: cols[4] ? Number(cols[4]) : null,
            timestamp: cols[5] ? Number(cols[5]) : Date.now(),
          };
        }
      }
    } catch {
      // ignore transient read errors
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 300));
  }

  return { ok: false, requestId, status: "TIMEOUT", message: "No MT4 execution result received in time" };
};

const executeMt4Command = async (request) => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({ action: "execute", request });
  }

  await ensureMt4Dir();

  const cmdPath = commandPath();
  const current = fs.existsSync(cmdPath) ? fs.readFileSync(cmdPath, "utf8").trim() : "";
  if (current) {
    return { ok: false, status: "BUSY", message: "MT4 bridge command channel busy. Try again shortly." };
  }

  const line = buildCommandLine(request);
  await fsPromises.writeFile(cmdPath, `${line}\n`, "utf8");
  return waitForResult(request.id, MT4_EXEC_TIMEOUT_MS);
};

const validateAllowedSymbol = (symbol) => {
  if (!MT4_ALLOWED_SYMBOLS.length) return true;
  const raw = String(symbol || "").toUpperCase().replace("/", "");
  const rawNorm = normalizeSymbolToken(raw);
  return MT4_ALLOWED_SYMBOLS.some((allowed) => {
    const allowedRaw = String(allowed || "").toUpperCase().replace("/", "");
    const allowedNorm = normalizeSymbolToken(allowedRaw);
    return (
      allowedRaw === raw ||
      allowedNorm === rawNorm ||
      allowedNorm.startsWith(rawNorm) ||
      rawNorm.startsWith(allowedNorm)
    );
  });
};

const resolveExecutableSymbol = async (symbol) => {
  const requested = String(symbol || "").trim().toUpperCase();
  if (!requested) return { ok: false, error: "symbol is required" };

  const specsResult = await readMt4SymbolSpecs({});
  if (!specsResult.ok || !Array.isArray(specsResult.specs) || specsResult.specs.length === 0) {
    return { ok: true, symbol: requested };
  }

  const specs = specsResult.specs
    .filter((spec) => !MT5_NATIVE_MODE || Number(spec?.tradeMode ?? 4) !== 0)
    .map((spec) => String(spec?.symbol || "").trim())
    .filter(Boolean);
  const specUpper = specs.map((spec) => spec.toUpperCase());
  const candidates = mt4SymbolCandidates(requested).map((c) => String(c || "").trim().toUpperCase());

  for (const candidate of candidates) {
    const idx = specUpper.indexOf(candidate);
    if (idx >= 0) return { ok: true, symbol: specs[idx] };
  }

  const requestedNorm = normalizeSymbolToken(requested);
  const scored = specs
    .map((spec) => {
      const norm = normalizeSymbolToken(spec);
      let score = -1;
      if (norm === requestedNorm) score = 100;
      else if (norm.startsWith(requestedNorm)) score = 80;
      else if (requestedNorm.startsWith(norm)) score = 70;
      else if (requestedNorm.length >= 3 && norm.includes(requestedNorm)) score = 50;
      const penalty = Math.abs(norm.length - requestedNorm.length);
      return { spec, score, penalty };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => (b.score - a.score) || (a.penalty - b.penalty));

  if (scored.length) {
    return { ok: true, symbol: scored[0].spec };
  }

  return {
    ok: false,
    error: `symbol ${requested} is not available in MT4 symbols feed`,
  };
};

const validateOrderRequest = (payload) => {
  const action = String(payload.action || "").toUpperCase();

  if (!["PLACE", "PENDING", "CLOSE", "MODIFY"].includes(action)) {
    return { ok: false, error: "action must be PLACE, PENDING, CLOSE, or MODIFY" };
  }

  if (action === "PLACE") {
    const symbol = String(payload.symbol || "").trim().toUpperCase();
    const side = String(payload.side || "").trim().toUpperCase();
    const lots = Number(payload.lots);
    const sl = payload.sl !== undefined ? Number(payload.sl) : null;
    const tp = payload.tp !== undefined ? Number(payload.tp) : null;

    if (!symbol) return { ok: false, error: "symbol is required for PLACE" };
    if (!validateAllowedSymbol(symbol)) return { ok: false, error: `symbol ${symbol} is not allowed` };
    if (!["BUY", "SELL"].includes(side)) return { ok: false, error: "side must be BUY or SELL" };
    if (!Number.isFinite(lots) || lots <= 0) return { ok: false, error: "lots must be > 0" };
    if (lots > MT4_MAX_LOT_PER_ORDER) return { ok: false, error: `lots exceeds MT4_MAX_LOT_PER_ORDER (${MT4_MAX_LOT_PER_ORDER})` };
    if (MT4_REQUIRE_SL_TP && (!Number.isFinite(sl) || !Number.isFinite(tp))) {
      return { ok: false, error: "sl and tp are required by MT4_REQUIRE_SL_TP" };
    }

    return {
      ok: true,
      request: {
        action,
        symbol,
        side,
        lots,
        sl: Number.isFinite(sl) ? sl : null,
        tp: Number.isFinite(tp) ? tp : null,
        symbolCooldownSec: Number.isFinite(Number(payload.symbolCooldownSec))
          ? Math.max(0, Math.min(86400, Number(payload.symbolCooldownSec)))
          : null,
        maxOpenTrades: Number.isFinite(Number(payload.maxOpenTrades))
          ? Math.max(1, Math.min(100, Math.floor(Number(payload.maxOpenTrades))))
          : null,
        enforceSymbolCooldown: toBooleanFlag(payload.enforceSymbolCooldown, true),
        enforceDailyLossLimit: toBooleanFlag(payload.enforceDailyLossLimit, true),
        deviation: Number.isFinite(Number(payload.deviation)) ? Number(payload.deviation) : 20,
        comment: String(payload.comment || "web-bridge"),
      },
      summary: `${action} ${side} ${symbol} lots=${lots}`,
    };
  }

  if (action === "PENDING") {
    const symbol = String(payload.symbol || "").trim().toUpperCase();
    const orderType = String(payload.orderType || "").trim().toUpperCase();
    const lots = Number(payload.lots);
    const price = Number(payload.price);
    const sl = payload.sl !== undefined ? Number(payload.sl) : null;
    const tp = payload.tp !== undefined ? Number(payload.tp) : null;

    if (!symbol) return { ok: false, error: "symbol is required for PENDING" };
    if (!validateAllowedSymbol(symbol)) return { ok: false, error: `symbol ${symbol} is not allowed` };
    if (!["BUY_LIMIT", "SELL_LIMIT", "BUY_STOP", "SELL_STOP"].includes(orderType)) {
      return { ok: false, error: "orderType must be BUY_LIMIT, SELL_LIMIT, BUY_STOP, or SELL_STOP" };
    }
    if (!Number.isFinite(lots) || lots <= 0) return { ok: false, error: "lots must be > 0" };
    if (lots > MT4_MAX_LOT_PER_ORDER) return { ok: false, error: `lots exceeds MT4_MAX_LOT_PER_ORDER (${MT4_MAX_LOT_PER_ORDER})` };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "price is required for PENDING" };
    if (MT4_REQUIRE_SL_TP && (!Number.isFinite(sl) || !Number.isFinite(tp))) {
      return { ok: false, error: "sl and tp are required by MT4_REQUIRE_SL_TP" };
    }

    return {
      ok: true,
      request: {
        action,
        symbol,
        orderType,
        lots,
        price,
        sl: Number.isFinite(sl) ? sl : null,
        tp: Number.isFinite(tp) ? tp : null,
        symbolCooldownSec: Number.isFinite(Number(payload.symbolCooldownSec))
          ? Math.max(0, Math.min(86400, Number(payload.symbolCooldownSec)))
          : null,
        maxOpenTrades: Number.isFinite(Number(payload.maxOpenTrades))
          ? Math.max(1, Math.min(100, Math.floor(Number(payload.maxOpenTrades))))
          : null,
        enforceSymbolCooldown: toBooleanFlag(payload.enforceSymbolCooldown, true),
        enforceDailyLossLimit: toBooleanFlag(payload.enforceDailyLossLimit, true),
        deviation: Number.isFinite(Number(payload.deviation)) ? Number(payload.deviation) : 20,
        comment: String(payload.comment || "web-bridge"),
      },
      summary: `${action} ${orderType} ${symbol} lots=${lots} price=${price}`,
    };
  }

  if (action === "CLOSE") {
    const ticket = Number(payload.ticket);
    const lots = payload.lots !== undefined ? Number(payload.lots) : null;
    if (!Number.isFinite(ticket) || ticket <= 0) return { ok: false, error: "valid ticket is required for CLOSE" };
    if (lots !== null && (!Number.isFinite(lots) || lots <= 0)) return { ok: false, error: "lots must be > 0 when provided" };

    return {
      ok: true,
      request: {
        action,
        ticket,
        lots,
        deviation: Number.isFinite(Number(payload.deviation)) ? Number(payload.deviation) : 20,
      },
      summary: `${action} ticket=${ticket}${lots ? ` lots=${lots}` : ""}`,
    };
  }

  const ticket = Number(payload.ticket);
  const sl = payload.sl !== undefined ? Number(payload.sl) : null;
  const tp = payload.tp !== undefined ? Number(payload.tp) : null;
  if (!Number.isFinite(ticket) || ticket <= 0) return { ok: false, error: "valid ticket is required for MODIFY" };
  if (!Number.isFinite(sl) && !Number.isFinite(tp)) return { ok: false, error: "sl or tp is required for MODIFY" };

  return {
    ok: true,
    request: {
      action,
      ticket,
      sl: Number.isFinite(sl) ? sl : null,
      tp: Number.isFinite(tp) ? tp : null,
    },
    summary: `${action} ticket=${ticket}`,
  };
};

const normalizeSymbolToken = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const toBooleanFlag = (value, defaultValue = true) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no", "disabled", "inactive"].includes(normalized)) return false;
    if (["true", "1", "on", "yes", "enabled", "active"].includes(normalized)) return true;
  }
  return defaultValue;
};

const getLiveReferencePrice = async (symbol) => {
  const symbolCandidates = mt4SymbolCandidates(symbol);
  for (const candidate of symbolCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await readMt4Candles({ symbol: candidate, timeframe: "M1", count: 5 });
    if (result.ok && Array.isArray(result.candles) && result.candles.length) {
      const last = result.candles[result.candles.length - 1];
      return { ok: true, price: Number(last.close || 0) };
    }
  }
  return { ok: false, error: `Unable to resolve live reference price for ${symbol}` };
};

const enforcePlaceRiskPolicy = async (request) => {
  const evaluation = await evaluatePlaceRiskPolicy(request);
  if (evaluation.ok) return { ok: true };
  const failed = evaluation.checks.find((check) => !check.ok);
  return {
    ok: false,
    error: failed ? `Risk policy: ${failed.rule}${failed.detail ? ` (${failed.detail})` : ""}` : "Risk policy check failed",
    checks: evaluation.checks,
  };
};

const evaluatePlaceRiskPolicy = async (request) => {
  const checks = [];
  const addCheck = (rule, ok, detail) => {
    checks.push({ rule, ok: Boolean(ok), detail: detail || "" });
  };
  const formatCooldownDetail = (seconds) => {
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    if (sec <= 0) return "ready";
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s remaining (${sec}s)`;
  };
  const enforceSymbolCooldown = toBooleanFlag(request.enforceSymbolCooldown, true);
  const enforceDailyLossLimit = toBooleanFlag(request.enforceDailyLossLimit, true);
  const maxOpenTrades = Number.isFinite(Number(request.maxOpenTrades))
    ? Math.max(1, Math.min(100, Math.floor(Number(request.maxOpenTrades))))
    : MT4_MAX_OPEN_TRADES;
  const normalizeCooldownKey = (symbolValue) => {
    const token = normalizeSymbolToken(symbolValue);
    // Unify micro-suffix variants: EURUSDM <-> EURUSD, GOLDM <-> GOLD
    if (token.length >= 7 && token.endsWith("M")) return token.slice(0, -1);
    return token;
  };
  const collectCooldownCommentPrefixes = (commentValue) => {
    const raw = String(commentValue || "").trim();
    if (!raw) return [];
    const prefixes = [raw];
    const timeframeStripped = raw.replace(/-(M\d+|H\d+|D1|W1|MN)$/i, "");
    if (timeframeStripped && timeframeStripped !== raw) {
      prefixes.push(timeframeStripped);
    }
    return Array.from(new Set(prefixes.map((item) => item.trim()).filter(Boolean)));
  };

  if (request.action !== "PLACE" && request.action !== "PENDING") {
    addCheck("action", true, "No PLACE-specific policy required");
    return { ok: true, checks };
  }

  const openResult = await listOpenPositions();
  if (openResult.ok) {
    const positions = Array.isArray(openResult.positions) ? openResult.positions : [];
    const openTradesOk = positions.length < maxOpenTrades;
    addCheck("max_open_trades", openTradesOk, `${positions.length}/${maxOpenTrades} open`);

    const target = normalizeCooldownKey(request.symbol);
    const perSymbol = positions.filter((p) =>
      normalizeCooldownKey(p.symbol).startsWith(target)
    ).length;
    const perSymbolOk = perSymbol < MT4_MAX_OPEN_PER_SYMBOL;
    addCheck("max_open_per_symbol", perSymbolOk, `${perSymbol}/${MT4_MAX_OPEN_PER_SYMBOL} for ${request.symbol}`);
  } else {
    addCheck("open_positions_feed", false, openResult.error || "Could not read open positions");
  }

  const historyResult = await readMt4History();
  const accountResult = await readMt4AccountSnapshot();
  if (historyResult.ok && Array.isArray(historyResult.trades)) {
    const target = normalizeCooldownKey(request.symbol);
    const cooldownCommentPrefixes = collectCooldownCommentPrefixes(request.comment);
    // Prefer MT4-exported account timestamp so cooldown math uses the same clock
    // as history closeTime/openTime values written by the EA.
    const accountNowSec = Number(accountResult?.account?.timestamp || 0);
    const nowSec = Number.isFinite(accountNowSec) && accountNowSec > 0
      ? Math.floor(accountNowSec)
      : Math.floor(Date.now() / 1000);
    const recentTrade = historyResult.trades
      .filter((t) => {
        if (!normalizeCooldownKey(t.symbol).startsWith(target)) return false;
        if (!cooldownCommentPrefixes.length) return true;
        const comment = String(t.comment || "");
        return cooldownCommentPrefixes.some((prefix) => comment.startsWith(prefix));
      })
      .map((t) => ({
        ticket: Number(t.ticket || 0),
        closeTime: Number(t.closeTime || 0),
      }))
      .filter((t) => t.closeTime > 0)
      .sort((a, b) => {
        if (b.closeTime !== a.closeTime) return b.closeTime - a.closeTime;
        return b.ticket - a.ticket;
      })[0];
    const recentClose = recentTrade ? Number(recentTrade.closeTime || 0) : 0;

    const cooldownSec = Number.isFinite(Number(request.symbolCooldownSec))
      ? Math.max(0, Math.min(86400, Number(request.symbolCooldownSec)))
      : MT4_SYMBOL_COOLDOWN_SEC;
    // Stateless cooldown: based only on most recent close timestamp.
    // This prevents policy rechecks from re-arming cooldown repeatedly.
    let cooldownLeft = 0;
    if (recentTrade && recentClose > 0) {
      const closeSec = Math.max(0, Math.floor(recentClose));
      const expiresAtSec = closeSec + cooldownSec;
      cooldownLeft = Math.max(0, expiresAtSec - nowSec);
    }
    if (enforceSymbolCooldown) {
      addCheck(
        "symbol_cooldown",
        !recentClose || cooldownLeft <= 0,
        recentClose
          ? formatCooldownDetail(cooldownLeft)
          : cooldownCommentPrefixes.length
          ? "no recent bot-tagged close"
          : "no recent close"
      );
    } else {
      addCheck("symbol_cooldown", true, "inactive");
    }

    if (enforceDailyLossLimit) {
      if (accountResult.ok && accountResult.account?.balance > 0) {
        const balance = Number(accountResult.account.balance);
        const dayStartSec = Math.floor(Date.now() / 1000 / 86400) * 86400;
        const dailyPnl = historyResult.trades
          .filter((t) => Number(t.closeTime || 0) >= dayStartSec)
          .reduce((sum, t) => sum + Number(t.profit || 0), 0);
        const dailyLossPct = dailyPnl < 0 ? (Math.abs(dailyPnl) / balance) * 100 : 0;
        addCheck(
          "daily_loss_limit",
          dailyLossPct < MT4_DAILY_LOSS_LIMIT_PCT,
          `${dailyLossPct.toFixed(2)}% / ${MT4_DAILY_LOSS_LIMIT_PCT}%`
        );
      } else {
        addCheck("daily_loss_limit", false, "Account snapshot unavailable");
      }
    } else {
      addCheck("daily_loss_limit", true, "inactive");
    }
  } else {
    addCheck("history_feed", false, historyResult.error || "Could not read history");
  }

  let entry = 0;
  let sideForCheck = "";

  if (request.action === "PLACE") {
    const live = await getLiveReferencePrice(request.symbol);
    if (!live.ok || !Number.isFinite(live.price) || live.price <= 0) {
      addCheck("live_reference_price", false, live.error || "No MT4 live reference");
      const ok = checks.every((c) => c.ok);
      return { ok, checks };
    }
    entry = Number(live.price);
    sideForCheck = request.side;
    addCheck("live_reference_price", true, `entry ref ${Number(entry).toFixed(5)}`);
  } else {
    entry = Number(request.price);
    sideForCheck = request.orderType.startsWith("BUY") ? "BUY" : "SELL";
    addCheck("pending_entry_price", Number.isFinite(entry) && entry > 0, `entry=${entry}`);
  }

  const sl = Number(request.sl);
  const tp = Number(request.tp);

  const directionOk =
    sideForCheck === "BUY" ? sl < entry && tp > entry : sideForCheck === "SELL" ? sl > entry && tp < entry : false;
  addCheck("sl_tp_direction", directionOk, `${sideForCheck} | entry=${entry} sl=${sl} tp=${tp}`);

  const riskDistance = Math.abs(entry - sl);
  const rewardDistance = Math.abs(tp - entry);
  const distanceOk = riskDistance > 0 && rewardDistance > 0;
  addCheck("sl_tp_distance", distanceOk, `risk=${riskDistance.toFixed(6)} reward=${rewardDistance.toFixed(6)}`);

  const rr = distanceOk ? rewardDistance / riskDistance : 0;
  addCheck("min_rr", rr >= MT4_MIN_RR, `${rr.toFixed(2)} / ${MT4_MIN_RR}`);

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
};

const listOpenPositions = async () => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({ action: "positions" });
  }

  try {
    const file = positionsPath();
    if (!fs.existsSync(file)) return { ok: true, positions: [] };

    const content = await readFileWithRetry(file);
    const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const positions = rows.map((row) => {
      const cols = row.includes(",") ? row.split(",") : row.split(";");
      return {
        ticket: Number(cols[0] || 0),
        symbol: cols[1] || "",
        type: cols[2] || "",
        lots: Number(cols[3] || 0),
        openPrice: Number(cols[4] || 0),
        sl: Number(cols[5] || 0),
        tp: Number(cols[6] || 0),
        openTime: Number(cols[7] || 0),
      };
    });

    return { ok: true, positions };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const readMt4AccountSnapshot = async () => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({ action: "account" });
  }

  try {
    const file = accountPath();
    if (!fs.existsSync(file)) {
      return { ok: false, error: `MT4 account file not found. Expected at ${file}` };
    }

    const content = await readFileWithRetry(file);
    const row = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (!row) return { ok: false, error: "MT4 account file is empty" };

    const cols = row.includes(",") ? row.split(",") : row.split(";");
    return {
      ok: true,
      account: {
        balance: Number(cols[0] || 0),
        equity: Number(cols[1] || 0),
        margin: Number(cols[2] || 0),
        freeMargin: Number(cols[3] || 0),
        leverage: Number(cols[4] || 0),
        login: Number(cols[5] || 0),
        currency: cols[6] || "USD",
        timestamp: Number(cols[7] || 0),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const readMt4History = async () => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({ action: "history", days: 90, limit: 500 });
  }

  try {
    const file = historyPath();
    if (!fs.existsSync(file)) {
      return { ok: false, error: `MT4 history file not found. Expected at ${file}` };
    }

    const content = await readFileWithRetry(file);
    const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const trades = rows.map((row) => {
      const cols = row.includes(",") ? row.split(",") : row.split(";");
      return {
        ticket: Number(cols[0] || 0),
        symbol: cols[1] || "",
        type: cols[2] || "",
        lots: Number(cols[3] || 0),
        openPrice: Number(cols[4] || 0),
        sl: Number(cols[5] || 0),
        tp: Number(cols[6] || 0),
        closePrice: Number(cols[7] || 0),
        profit: Number(cols[8] || 0),
        openTime: Number(cols[9] || 0),
        closeTime: Number(cols[10] || 0),
        comment: cols.slice(11).join(",") || "",
      };
    });

    return { ok: true, trades };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const readMt4Ticks = async ({ symbol } = {}) => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({ action: "ticks", symbol: symbol || "", count: 100 });
  }

  try {
    const file = ticksPath();
    if (!fs.existsSync(file)) {
      return { ok: false, error: `MT4 ticks file not found. Expected at ${file}` };
    }

    const content = await readFileWithRetry(file);
    const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const ticks = rows.map((row) => {
      const cols = row.includes(",") ? row.split(",") : row.split(";");
      return {
        symbol: String(cols[0] || ""),
        bid: Number(cols[1] || 0),
        ask: Number(cols[2] || 0),
        time: Number(cols[3] || 0),
      };
    });

    const valid = ticks.filter((tick) => tick.symbol && Number.isFinite(tick.bid) && Number.isFinite(tick.ask) && tick.time > 0);
    if (!symbol) return { ok: true, ticks: valid };

    const resolvedExecutable = await resolveExecutableSymbol(symbol);
    const preferredSymbol = resolvedExecutable.ok && resolvedExecutable.symbol ? resolvedExecutable.symbol : symbol;
    const candidates = Array.from(new Set([
      String(preferredSymbol || "").trim(),
      ...mt4SymbolCandidates(symbol),
    ].filter(Boolean))).map((candidate) => normalizeSymbolToken(candidate));
    const selected = valid.filter((tick) => {
      const raw = normalizeSymbolToken(tick.symbol);
      return candidates.some((candidate) => raw.startsWith(candidate) || candidate.startsWith(raw));
    });

    if (!selected.length) {
      return { ok: false, error: `No MT4 tick found for ${symbol}` };
    }

    selected.sort((a, b) => b.time - a.time);
    return { ok: true, tick: selected[0], ticks: selected };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const readMt4Market = async ({ symbol, timeframe = "D1", count = 300 } = {}) => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({ action: "market", symbol: symbol || "", timeframe, count });
  }

  const [candlesResult, ticksResult] = await Promise.all([
    readMt4Candles({ symbol, timeframe, count }),
    readMt4Ticks({ symbol }),
  ]);
  const tick = ticksResult?.tick || (Array.isArray(ticksResult?.ticks) ? ticksResult.ticks[0] : null);
  if (!candlesResult?.ok) return candlesResult;
  return {
    ok: true,
    source: candlesResult.source || "MT4",
    symbol: candlesResult.symbol || symbol,
    requested_symbol: symbol,
    timeframe,
    candles: candlesResult.candles || [],
    tick,
  };
};

const readMt4PolicyEvents = async ({ limit = 100 } = {}) => {
  if (MT5_NATIVE_MODE) {
    return { ok: true, events: [], limit };
  }

  try {
    const file = policyPath();
    if (!fs.existsSync(file)) {
      return { ok: false, error: `MT4 policy file not found. Expected at ${file}` };
    }

    const content = await fsPromises.readFile(file, "utf8");
    const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const events = rows
      .map((row) => {
        const cols = row.includes(",") ? row.split(",") : row.split(";");
        return {
          time: Number(cols[0] || 0),
          symbol: String(cols[1] || ""),
          event: String(cols[2] || ""),
          severity: String(cols[3] || ""),
          detail: cols.slice(4).join(",") || "",
        };
      })
      .filter((item) => item.time > 0 && item.event);

    events.sort((a, b) => b.time - a.time);
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    return { ok: true, events: events.slice(0, safeLimit) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const readMt4SymbolSpecs = async ({ symbol } = {}) => {
  if (MT5_NATIVE_MODE) {
    return runMt5Adapter({ action: "symbols", symbol: symbol || "" });
  }

  try {
    const file = symbolsPath();
    if (!fs.existsSync(file)) {
      return { ok: false, error: `MT4 symbols file not found. Expected at ${file}` };
    }

    const content = await readFileWithRetry(file);
    const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const specs = rows.map((row) => {
      const cols = row.includes(",") ? row.split(",") : row.split(";");
      return {
        symbol: String(cols[0] || ""),
        lotSize: Number(cols[1] || 0),
        digits: Number(cols[2] || 0),
        point: Number(cols[3] || 0),
        tickValue: Number(cols[4] || 0),
        tickSize: Number(cols[5] || 0),
      };
    }).filter((spec) => spec.symbol);

    if (!symbol) return { ok: true, specs };

    const target = normalizeSymbolToken(symbol);
    const match = specs.find((spec) => normalizeSymbolToken(spec.symbol).startsWith(target));
    if (!match) return { ok: false, error: `No MT4 symbol spec found for ${symbol}` };
    return { ok: true, spec: match, specs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const decodeXmlEntities = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const stripHtmlTags = (value) => String(value || "").replace(/<[^>]+>/g, "").trim();

const extractXmlTag = (block, tag) => {
  const match = String(block || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1]) : "";
};

const parseDateMs = (value) => {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
};

const normalizeAlphaTimestamp = (value) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return raw;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
};

const mapSymbolToYahooTicker = (symbol) => {
  const normalized = normalizeSymbolToken(symbol);
  if (!normalized) return "";
  if (normalized.includes("US30") || normalized === "DJI") return "^DJI";
  if (normalized.includes("GOLD") || normalized.includes("XAU")) return "XAUUSD=X";
  if (normalized.includes("SILVER") || normalized.includes("XAG")) return "XAGUSD=X";
  if (normalized === "BTCUSD") return "BTC-USD";
  if (normalized === "ETHUSD") return "ETH-USD";
  if (normalized === "SOLUSD") return "SOL-USD";
  if (normalized === "XRPUSD") return "XRP-USD";
  if (normalized.length === 6) return `${normalized}=X`;
  return normalized;
};

const mapSymbolToAlphaTicker = (symbol) => {
  const normalized = normalizeSymbolToken(symbol);
  if (!normalized) return "";
  if (normalized.includes("US30") || normalized === "DJI") return "DJI";
  if (normalized.includes("GOLD") || normalized.includes("XAU")) return "FOREX:XAUUSD";
  if (normalized.includes("SILVER") || normalized.includes("XAG")) return "FOREX:XAGUSD";
  if (normalized === "BTCUSD") return "CRYPTO:BTC";
  if (normalized === "ETHUSD") return "CRYPTO:ETH";
  if (normalized === "SOLUSD") return "CRYPTO:SOL";
  if (normalized === "XRPUSD") return "CRYPTO:XRP";
  if (normalized.length === 6) return `FOREX:${normalized}`;
  return normalized;
};

const fetchTextWithTimeout = async (targetUrl, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Trading-App-Market-Bridge/1.0",
        Accept: "application/json,text/xml,application/xml,text/plain,*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const text = await response.text();
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
};

const fetchJsonWithTimeout = async (targetUrl, timeoutMs = 8000) => {
  const raw = await fetchTextWithTimeout(targetUrl, timeoutMs);
  if (!raw.ok) return raw;
  try {
    return { ok: true, json: JSON.parse(raw.text || "{}") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON response" };
  }
};

const postJsonWithTimeout = async (targetUrl, payload, headers = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const raw = await response.text();
    let json = {};
    try {
      json = raw && raw.trim() ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      json: {},
    };
  } finally {
    clearTimeout(timer);
  }
};

const buildAiPromptText = (system, prompt) => {
  const systemText = String(system || "").trim();
  const promptText = String(prompt || "").trim();
  if (systemText && promptText) return `${systemText}\n\n${promptText}`;
  return systemText || promptText;
};

const isAiLimitLike = (status, message) => {
  const lowered = String(message || "").toLowerCase();
  return (
    status === 429 ||
    lowered.includes("quota") ||
    lowered.includes("rate") ||
    lowered.includes("resource_exhausted") ||
    lowered.includes("limit") ||
    lowered.includes("exceeded")
  );
};

const callGeminiText = async ({ prompt, system }) => {
  if (!GEMINI_API_KEY) {
    return { ok: false, limitLike: false, error: "Gemini key not configured" };
  }
  const promptText = buildAiPromptText(system, prompt);
  const response = await postJsonWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      contents: [{ role: "user", parts: [{ text: promptText }] }],
    }
  );
  if (!response.ok) {
    const message = response.json?.error?.message || response.error || "Gemini request failed";
    return {
      ok: false,
      limitLike: isAiLimitLike(response.status, message),
      error: String(message),
    };
  }
  const text = response.json?.candidates?.[0]?.content?.parts
    ?.map((part) => String(part?.text || ""))
    .join("\n")
    .trim();
  if (!text) {
    return { ok: false, limitLike: false, error: "Gemini returned an empty response" };
  }
  return { ok: true, provider: "GEMINI", text, model: GEMINI_MODEL };
};

const callOpenAiText = async ({ prompt, system, temperature }) => {
  if (!OPENAI_API_KEY) {
    return { ok: false, error: "OpenAI key not configured" };
  }
  const messages = [];
  if (String(system || "").trim()) {
    messages.push({ role: "system", content: String(system).trim() });
  }
  messages.push({ role: "user", content: String(prompt || "").trim() });

  const response = await postJsonWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      messages,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.3,
    },
    {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    }
  );
  if (!response.ok) {
    const message = response.json?.error?.message || response.error || "OpenAI request failed";
    return { ok: false, error: String(message) };
  }
  const text = String(response.json?.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    return { ok: false, error: "OpenAI returned an empty response" };
  }
  return { ok: true, provider: "OPENAI", text, model: OPENAI_MODEL };
};

const generateAiCompletion = async ({ prompt, system, temperature }) => {
  const promptText = String(prompt || "").trim();
  if (!promptText) {
    return { ok: false, status: 400, error: "prompt is required" };
  }
  if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
    return {
      ok: false,
      status: 503,
      error:
        "AI providers not configured. Set GEMINI_API_KEY and/or OPENAI_API_KEY in .env.local and restart the market bridge.",
    };
  }

  let geminiError = "";
  if (GEMINI_API_KEY) {
    const geminiResult = await callGeminiText({ prompt: promptText, system });
    if (geminiResult.ok) {
      return {
        ok: true,
        provider: geminiResult.provider,
        text: geminiResult.text,
        model: geminiResult.model,
      };
    }
    geminiError = geminiResult.error || "Gemini request failed";
  }

  if (OPENAI_API_KEY) {
    const openaiResult = await callOpenAiText({ prompt: promptText, system, temperature });
    if (openaiResult.ok) {
      return {
        ok: true,
        provider: openaiResult.provider,
        text: openaiResult.text,
        model: openaiResult.model,
      };
    }
    if (geminiError) {
      return {
        ok: false,
        status: 502,
        error: `Gemini failed: ${geminiError} | OpenAI failed: ${openaiResult.error}`,
      };
    }
    return { ok: false, status: 502, error: openaiResult.error || "OpenAI request failed" };
  }

  return { ok: false, status: 502, error: geminiError || "Gemini request failed" };
};

const parseCandleTimeSec = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
};

const aggregateCandlesByBucketSec = (candles, bucketSec, limit) => {
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(bucketSec) || bucketSec <= 0) return [];
  const aggregated = [];
  for (const candle of candles) {
    const time = Number(candle?.time || 0);
    if (!Number.isFinite(time) || time <= 0) continue;
    const bucketTime = Math.floor(time / bucketSec) * bucketSec;
    const last = aggregated[aggregated.length - 1];
    if (last && last.time === bucketTime) {
      last.high = Math.max(last.high, Number(candle.high));
      last.low = Math.min(last.low, Number(candle.low));
      last.close = Number(candle.close);
      last.volume += Number(candle.volume || 0);
      continue;
    }
    aggregated.push({
      time: bucketTime,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume || 0),
    });
  }
  return aggregated.slice(-Math.max(50, Math.min(2000, Number(limit) || 300)));
};

const getFallbackBucketSec = (timeframe) => {
  switch (String(timeframe || "D1").toUpperCase()) {
    case "M1":
      return 60;
    case "M5":
      return 5 * 60;
    case "M15":
      return 15 * 60;
    case "M30":
      return 30 * 60;
    case "H1":
      return 60 * 60;
    case "H4":
      return 4 * 60 * 60;
    case "D1":
      return 24 * 60 * 60;
    case "W1":
      return 7 * 24 * 60 * 60;
    case "MN":
      return 30 * 24 * 60 * 60;
    default:
      return 15 * 60;
  }
};

const getFallbackCacheTtlMs = (timeframe) =>
  Math.min(5 * 60 * 1000, Math.max(30 * 1000, Math.floor((getFallbackBucketSec(timeframe) * 1000) / 3)));

const isFallbackRateLimitLike = (error) => {
  const lowered = String(error || "").toLowerCase();
  return (
    lowered.includes("current minute") ||
    lowered.includes("api credits") ||
    lowered.includes("rate limit") ||
    lowered.includes("25 requests per day") ||
    lowered.includes("premium endpoint")
  );
};

const getFallbackFailureTtlMs = (timeframe, error) =>
  isFallbackRateLimitLike(error)
    ? Math.max(65 * 1000, getFallbackCacheTtlMs(timeframe))
    : Math.min(60 * 1000, Math.max(15 * 1000, Math.floor(getFallbackCacheTtlMs(timeframe) / 2)));

const FALLBACK_CANDLE_CACHE = new Map();

const TWELVE_DATA_INTERVALS = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
  H4: "4h",
  D1: "1day",
  W1: "1week",
  MN: "1month",
};

const mapSymbolToTwelveDataSymbol = (symbol) => {
  const normalized = normalizeSymbolToken(symbol);
  if (!normalized) return "";
  if (normalized.includes("GOLD") || normalized.includes("XAU")) return "XAU/USD";
  if (normalized.includes("SILVER") || normalized.includes("XAG")) return "XAG/USD";
  if (normalized.includes("USOIL") || normalized.includes("WTI") || normalized.includes("XTI")) return "XTI/USD";
  if (normalized.length >= 6) return `${normalized.slice(0, 3)}/${normalized.slice(3, 6)}`;
  return "";
};

const ALPHA_VANTAGE_INTRADAY_INTERVALS = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "60min",
};

const mapSymbolToAlphaVantageFxPair = (symbol) => {
  const normalized = normalizeSymbolToken(symbol);
  if (!normalized) return "";
  if (normalized.includes("GOLD") || normalized.includes("XAU")) return "XAUUSD";
  if (normalized.includes("SILVER") || normalized.includes("XAG")) return "XAGUSD";
  if (normalized.length === 6) return normalized;
  return "";
};

const fetchTwelveDataCandlesForSymbol = async ({ symbol, timeframe, count }) => {
  if (!TWELVE_DATA_API_KEY) {
    return { ok: false, error: "TWELVE_DATA_API_KEY not configured" };
  }

  const interval = TWELVE_DATA_INTERVALS[String(timeframe || "D1").toUpperCase()];
  if (!interval) {
    return { ok: false, error: `Unsupported timeframe ${timeframe}` };
  }

  const mappedSymbol = mapSymbolToTwelveDataSymbol(symbol);
  if (!mappedSymbol) {
    return { ok: false, error: `No Twelve Data symbol mapping for ${symbol}` };
  }

  const outputsize = Math.min(5000, Math.max(300, Number(count) || 300));
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=${outputsize}` +
    `&apikey=${encodeURIComponent(TWELVE_DATA_API_KEY)}`;
  const result = await fetchJsonWithTimeout(url, 10000);
  if (!result.ok) {
    return { ok: false, error: `Twelve Data fetch failed: ${result.error}` };
  }

  const payload = result.json || {};
  if (payload?.status === "error") {
    return { ok: false, error: String(payload?.message || payload?.code || "Twelve Data error") };
  }

  const values = Array.isArray(payload?.values) ? payload.values : [];
  const candles = values
    .map((item) => ({
      time: parseCandleTimeSec(item?.datetime),
      open: Number(item?.open),
      high: Number(item?.high),
      low: Number(item?.low),
      close: Number(item?.close),
      volume: Number.isFinite(Number(item?.volume)) ? Number(item?.volume) : 0,
    }))
    .filter(
      (candle) =>
        candle.time > 0 &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    )
    .sort((a, b) => a.time - b.time)
    .slice(-Math.max(50, Math.min(2000, Number(count) || 300)));

  if (!candles.length) {
    return { ok: false, error: `Twelve Data returned no candles for ${symbol} ${timeframe}` };
  }

  return {
    ok: true,
    source: "TWELVE_DATA",
    symbol: mappedSymbol,
    requested_symbol: symbol,
    timeframe: String(timeframe || "D1").toUpperCase(),
    candles,
  };
};

const fetchAlphaVantageCandlesForSymbol = async ({ symbol, timeframe, count }) => {
  if (!ALPHA_VANTAGE_API_KEY) {
    return { ok: false, error: "ALPHA_VANTAGE_API_KEY not configured" };
  }

  const tf = String(timeframe || "D1").toUpperCase();
  const mappedSymbol = mapSymbolToAlphaVantageFxPair(symbol);
  if (!mappedSymbol) {
    return { ok: false, error: `No Alpha Vantage symbol mapping for ${symbol}` };
  }

  const fromSymbol = mappedSymbol.slice(0, 3);
  const toSymbol = mappedSymbol.slice(3, 6);
  const intradayInterval = ALPHA_VANTAGE_INTRADAY_INTERVALS[tf];
  const parseSeriesEntries = (series) =>
    Object.entries(series || {})
      .map(([time, values]) => ({
        time: parseCandleTimeSec(time),
        open: Number(values?.["1. open"]),
        high: Number(values?.["2. high"]),
        low: Number(values?.["3. low"]),
        close: Number(values?.["4. close"]),
        volume: 0,
      }))
      .filter(
        (candle) =>
          candle.time > 0 &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close)
      )
      .sort((a, b) => a.time - b.time);

  if (intradayInterval) {
    const url =
      `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${encodeURIComponent(fromSymbol)}` +
      `&to_symbol=${encodeURIComponent(toSymbol)}&interval=${encodeURIComponent(intradayInterval)}` +
      `&outputsize=full&apikey=${encodeURIComponent(ALPHA_VANTAGE_API_KEY)}`;
    const result = await fetchJsonWithTimeout(url, 10000);
    if (!result.ok) {
      return { ok: false, error: `Alpha Vantage fetch failed: ${result.error}` };
    }
    const payload = result.json || {};
    if (payload?.["Error Message"] || payload?.Note || payload?.Information) {
      return {
        ok: false,
        error: String(payload?.Note || payload?.Information || payload?.["Error Message"] || "Alpha Vantage error"),
      };
    }
    const seriesKey = Object.keys(payload).find((key) => key.startsWith("Time Series FX"));
    const candles = parseSeriesEntries(seriesKey ? payload[seriesKey] : {});
    if (!candles.length) {
      return { ok: false, error: `Alpha Vantage returned no candles for ${symbol} ${tf}` };
    }
    return {
      ok: true,
      source: "ALPHA_VANTAGE",
      symbol: mappedSymbol,
      requested_symbol: symbol,
      timeframe: tf,
      candles: candles.slice(-Math.max(50, Math.min(2000, Number(count) || 300))),
    };
  }

  if (tf === "H4") {
    const h1 = await fetchAlphaVantageCandlesForSymbol({ symbol, timeframe: "H1", count: Math.max(400, Number(count) * 4) });
    if (!h1.ok || !Array.isArray(h1.candles) || !h1.candles.length) {
      return { ok: false, error: h1.error || `Alpha Vantage returned no H1 candles for ${symbol}` };
    }
    return {
      ok: true,
      source: "ALPHA_VANTAGE",
      symbol: h1.symbol,
      requested_symbol: symbol,
      timeframe: tf,
      candles: aggregateCandlesByBucketSec(h1.candles, 4 * 60 * 60, count),
    };
  }

  const url =
    `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${encodeURIComponent(fromSymbol)}` +
    `&to_symbol=${encodeURIComponent(toSymbol)}&outputsize=full&apikey=${encodeURIComponent(ALPHA_VANTAGE_API_KEY)}`;
  const result = await fetchJsonWithTimeout(url, 10000);
  if (!result.ok) {
    return { ok: false, error: `Alpha Vantage fetch failed: ${result.error}` };
  }
  const payload = result.json || {};
  if (payload?.["Error Message"] || payload?.Note || payload?.Information) {
    return {
      ok: false,
      error: String(payload?.Note || payload?.Information || payload?.["Error Message"] || "Alpha Vantage error"),
    };
  }
  const dailySeries = payload["Time Series FX (Daily)"] || {};
  const dailyCandles = parseSeriesEntries(dailySeries);
  if (!dailyCandles.length) {
    return { ok: false, error: `Alpha Vantage returned no daily candles for ${symbol}` };
  }
  const candles =
    tf === "D1"
      ? dailyCandles.slice(-Math.max(50, Math.min(2000, Number(count) || 300)))
      : tf === "W1"
      ? aggregateCandlesByBucketSec(dailyCandles, 7 * 24 * 60 * 60, count)
      : aggregateCandlesByBucketSec(dailyCandles, 30 * 24 * 60 * 60, count);
  return {
    ok: true,
    source: "ALPHA_VANTAGE",
    symbol: mappedSymbol,
    requested_symbol: symbol,
    timeframe: tf,
    candles,
  };
};

const YAHOO_CHART_INTERVALS = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "60m",
  H4: "60m",
  D1: "1d",
  W1: "1d",
  MN: "1d",
};

const getYahooChartRange = (timeframe) => {
  switch (String(timeframe || "D1").toUpperCase()) {
    case "M1":
      return "7d";
    case "M5":
    case "M15":
    case "M30":
      return "60d";
    case "H1":
    case "H4":
      return "730d";
    case "D1":
    case "W1":
      return "10y";
    case "MN":
      return "max";
    default:
      return "60d";
  }
};

const fetchYahooCandlesForSymbol = async ({ symbol, timeframe, count }) => {
  const tf = String(timeframe || "D1").toUpperCase();
  const ticker = mapSymbolToYahooTicker(symbol);
  if (!ticker) {
    return { ok: false, error: `No Yahoo Finance ticker mapping for ${symbol}` };
  }

  const interval = YAHOO_CHART_INTERVALS[tf];
  if (!interval) {
    return { ok: false, error: `Unsupported Yahoo Finance timeframe ${timeframe}` };
  }

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(getYahooChartRange(tf))}` +
    "&includePrePost=false&events=div%2Csplits";
  const result = await fetchJsonWithTimeout(url, 10000);
  if (!result.ok) {
    return { ok: false, error: `Yahoo Finance chart fetch failed: ${result.error}` };
  }

  const payload = result.json?.chart?.result?.[0];
  const timestamps = Array.isArray(payload?.timestamp) ? payload.timestamp : [];
  const quote = payload?.indicators?.quote?.[0] || {};
  const candles = timestamps
    .map((time, index) => ({
      time: Number(time || 0),
      open: Number(Array.isArray(quote.open) ? quote.open[index] : NaN),
      high: Number(Array.isArray(quote.high) ? quote.high[index] : NaN),
      low: Number(Array.isArray(quote.low) ? quote.low[index] : NaN),
      close: Number(Array.isArray(quote.close) ? quote.close[index] : NaN),
      volume: Number(Array.isArray(quote.volume) ? quote.volume[index] : 0),
    }))
    .filter(
      (candle) =>
        candle.time > 0 &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    )
    .sort((a, b) => a.time - b.time);

  if (!candles.length) {
    return { ok: false, error: `Yahoo Finance returned no candles for ${symbol} ${tf}` };
  }

  const normalizedCount = Math.max(50, Math.min(2000, Number(count) || 300));
  const finalCandles =
    tf === "H4"
      ? aggregateCandlesByBucketSec(candles, 4 * 60 * 60, normalizedCount)
      : tf === "W1"
      ? aggregateCandlesByBucketSec(candles, 7 * 24 * 60 * 60, normalizedCount)
      : tf === "MN"
      ? aggregateCandlesByBucketSec(candles, 30 * 24 * 60 * 60, normalizedCount)
      : candles.slice(-normalizedCount);

  return {
    ok: true,
    source: "YAHOO_FINANCE",
    symbol: ticker,
    requested_symbol: symbol,
    timeframe: tf,
    candles: finalCandles,
  };
};

const fetchFallbackCandles = async ({ symbol, timeframe, count }) => {
  const tf = String(timeframe || "D1").toUpperCase();
  const safeCount = Math.max(50, Math.min(2000, Number(count) || 300));
  const cacheKey = `${normalizeSymbolToken(symbol)}|${tf}|${safeCount}`;
  const nowMs = Date.now();
  const cached = FALLBACK_CANDLE_CACHE.get(cacheKey);
  if (cached && nowMs - cached.cachedAtMs < cached.ttlMs) {
    return { ...cached.result, cached: true };
  }

  const cacheResult = (result, ttlMs) => {
    FALLBACK_CANDLE_CACHE.set(cacheKey, {
      cachedAtMs: nowMs,
      ttlMs,
      result,
    });
    return result;
  };

  const twelveData = await fetchTwelveDataCandlesForSymbol({ symbol, timeframe, count });
  if (twelveData.ok && Array.isArray(twelveData.candles) && twelveData.candles.length >= 2) {
    return cacheResult(twelveData, getFallbackCacheTtlMs(tf));
  }

  const alphaVantage = await fetchAlphaVantageCandlesForSymbol({ symbol, timeframe, count });
  if (alphaVantage.ok && Array.isArray(alphaVantage.candles) && alphaVantage.candles.length >= 2) {
    return cacheResult(alphaVantage, getFallbackCacheTtlMs(tf));
  }

  const yahooFinance = await fetchYahooCandlesForSymbol({ symbol, timeframe, count });
  if (yahooFinance.ok && Array.isArray(yahooFinance.candles) && yahooFinance.candles.length >= 2) {
    return cacheResult(yahooFinance, getFallbackCacheTtlMs(tf));
  }

  if (cached?.result?.ok && Array.isArray(cached.result.candles) && cached.result.candles.length >= 2) {
    return {
      ...cached.result,
      cached: true,
      warning: "Using cached fallback candles because live providers are unavailable",
    };
  }

  const failureResult = {
    ok: false,
    error:
      [twelveData.error, alphaVantage.error, yahooFinance.error].filter(Boolean).join(" | ") ||
      `External fallback returned no usable candles for ${symbol} ${timeframe}`,
  };
  return cacheResult(failureResult, getFallbackFailureTtlMs(tf, failureResult.error));
};

const parseYahooRssNews = (xml, limit) => {
  const items = [];
  const matches = String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of matches) {
    const block = String(match?.[1] || "");
    const title = extractXmlTag(block, "title");
    const url = extractXmlTag(block, "link");
    const publishedRaw = extractXmlTag(block, "pubDate");
    const summary = stripHtmlTags(extractXmlTag(block, "description"));
    const publishedMs = parseDateMs(publishedRaw);
    if (!title || !url) continue;
    items.push({
      title,
      url,
      source: "Yahoo Finance RSS",
      publishedAt: publishedMs > 0 ? new Date(publishedMs).toISOString() : "",
      publishedAtMs: publishedMs,
      summary,
    });
  }
  return items
    .sort((a, b) => b.publishedAtMs - a.publishedAtMs)
    .slice(0, limit);
};

const fetchYahooNewsForSymbol = async (symbol, limit) => {
  const ticker = mapSymbolToYahooTicker(symbol);
  if (!ticker) return { provider: "YAHOO_FINANCE_RSS", items: [], warning: "No Yahoo ticker mapping" };
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
  const result = await fetchTextWithTimeout(url, 8000);
  if (!result.ok) {
    return { provider: "YAHOO_FINANCE_RSS", items: [], warning: `Yahoo fetch failed: ${result.error}` };
  }
  return { provider: "YAHOO_FINANCE_RSS", items: parseYahooRssNews(result.text, limit) };
};

const fetchAlphaNewsForSymbol = async (symbol, limit) => {
  if (!ALPHA_VANTAGE_API_KEY) {
    return { provider: "ALPHA_VANTAGE", items: [], warning: "ALPHA_VANTAGE_API_KEY not configured" };
  }
  const ticker = mapSymbolToAlphaTicker(symbol);
  if (!ticker) {
    return { provider: "ALPHA_VANTAGE", items: [], warning: "No Alpha ticker mapping" };
  }
  const url =
    `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(ticker)}` +
    `&limit=${Math.max(1, Math.min(20, limit))}&apikey=${encodeURIComponent(ALPHA_VANTAGE_API_KEY)}`;
  const result = await fetchJsonWithTimeout(url, 9000);
  if (!result.ok) {
    return { provider: "ALPHA_VANTAGE", items: [], warning: `Alpha fetch failed: ${result.error}` };
  }
  const feed = Array.isArray(result.json?.feed) ? result.json.feed : [];
  const items = feed.map((item) => {
    const publishedRaw = normalizeAlphaTimestamp(item?.time_published);
    const publishedMs = parseDateMs(publishedRaw);
    return {
      title: String(item?.title || "").trim(),
      url: String(item?.url || "").trim(),
      source: String(item?.source || "Alpha Vantage"),
      publishedAt: publishedMs > 0 ? new Date(publishedMs).toISOString() : "",
      publishedAtMs: publishedMs,
      summary: String(item?.summary || "").trim(),
      sentiment: String(item?.overall_sentiment_label || "").trim(),
    };
  }).filter((item) => item.title && item.url);
  return {
    provider: "ALPHA_VANTAGE",
    items: items.sort((a, b) => b.publishedAtMs - a.publishedAtMs).slice(0, limit),
  };
};

const mergeNewsItems = (items, limit) => {
  const seen = new Set();
  return items
    .sort((a, b) => (b.publishedAtMs || 0) - (a.publishedAtMs || 0))
    .filter((item) => {
      const key = String(item.url || item.title || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt || "",
      summary: item.summary || "",
      sentiment: item.sentiment || "",
    }));
};

const fetchMarketIntelForSymbols = async (symbols, limit = 6) => {
  const cappedLimit = Math.max(1, Math.min(12, Number(limit) || 6));
  const uniqueSymbols = Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((s) => String(s || "").trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, 20);

  const entries = await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      const [yahoo, alpha] = await Promise.all([
        fetchYahooNewsForSymbol(symbol, cappedLimit),
        fetchAlphaNewsForSymbol(symbol, cappedLimit),
      ]);
      const merged = mergeNewsItems([...(yahoo.items || []), ...(alpha.items || [])], cappedLimit);
      const resources = [yahoo.provider, alpha.provider].filter(Boolean);
      const warnings = [yahoo.warning, alpha.warning].filter(Boolean);
      return {
        symbol,
        resources,
        news: merged,
        warnings,
      };
    })
  );

  return {
    ok: true,
    fetchedAt: Date.now(),
    symbols: entries,
  };
};

const headlessTrader = await createHeadlessTrader({
  configPath: HEADLESS_CONFIG_PATH,
  env: process.env,
  readMt4Candles,
  readMt4Ticks,
  readMt4History,
  fetchMarketIntelForSymbols,
  readMt4AccountSnapshot,
  listOpenPositions,
  readMt4SymbolSpecs,
  resolveExecutableSymbol,
  validateAllowedSymbol,
  validateOrderRequest,
  evaluatePlaceRiskPolicy,
  executeMt4Command,
});

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { ok: false, error: "Missing request url" });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/mt5" || url.pathname.startsWith("/api/mt5/")) {
      url.pathname = `/api/mt4${url.pathname.slice("/api/mt5".length)}`;
    }

  if (url.pathname === "/health" || url.pathname === "/api/mt4/health" || url.pathname === "/api/mt4/health/") {
    const headlessStatus = headlessTrader.getStatus();
    const mt5Health = MT5_NATIVE_MODE ? await runMt5Adapter({ action: "health" }) : null;
    sendJson(res, 200, {
      ok: true,
      service: "market-bridge",
      bridge_version: BRIDGE_VERSION,
      mode: MT5_NATIVE_MODE ? "native-mt5" : "mt4-csv",
      trading_enabled: MT5_TRADING_ENABLED,
      mt5: mt5Health,
      capabilities: BRIDGE_CAPABILITIES,
      mt4_files_dir: MT4_FILES_DIR,
      mt4_files_dir_exists: fs.existsSync(MT4_FILES_DIR),
      mt4_command_file: path.join(MT4_FILES_DIR, MT4_COMMAND_FILE),
      mt4_policy_file: path.join(MT4_FILES_DIR, MT4_POLICY_FILE),
      headless: {
        config_file: HEADLESS_CONFIG_PATH,
        auto_enabled: headlessStatus.config.auto.enabled,
        protect_enabled: headlessStatus.config.protect.enabled,
        auto_running: headlessStatus.status.autoRunning,
        protect_running: headlessStatus.status.protectRunning,
      },
    });
    return;
  }

  if (url.pathname === "/api/mt4/candles" && req.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim();
    const timeframe = (url.searchParams.get("timeframe") || "D1").trim().toUpperCase();
    const count = Number(url.searchParams.get("count") || "300");

    if (!symbol) {
      sendJson(res, 400, { ok: false, error: "symbol is required" });
      return;
    }

    const result = await readMt4Candles({ symbol, timeframe, count: Number.isFinite(count) ? count : 300 });
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/market" && req.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim();
    const timeframe = (url.searchParams.get("timeframe") || "D1").trim().toUpperCase();
    const count = Number(url.searchParams.get("count") || "300");

    if (!symbol) {
      sendJson(res, 400, { ok: false, error: "symbol is required" });
      return;
    }

    const result = await readMt4Market({ symbol, timeframe, count: Number.isFinite(count) ? count : 300 });
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/fallback-candles" && req.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim();
    const timeframe = (url.searchParams.get("timeframe") || "D1").trim().toUpperCase();
    const count = Number(url.searchParams.get("count") || "300");

    if (!symbol) {
      sendJson(res, 400, { ok: false, error: "symbol is required" });
      return;
    }

    const result = await fetchFallbackCandles({
      symbol,
      timeframe,
      count: Number.isFinite(count) ? count : 300,
    });
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/orders/open" && req.method === "GET") {
    const result = await listOpenPositions();
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/account" && req.method === "GET") {
    const result = await readMt4AccountSnapshot();
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/history" && req.method === "GET") {
    const result = await readMt4History();
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/ticks" && req.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim();
    const result = await readMt4Ticks(symbol ? { symbol } : {});
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/policy-events" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") || "100");
    const result = await readMt4PolicyEvents({ limit });
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt4/symbols" && req.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim();
    const result = await readMt4SymbolSpecs(symbol ? { symbol } : {});
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if ((url.pathname === "/api/mt4/market-intel" || url.pathname === "/api/mt4/market-intel/") && req.method === "GET") {
    const rawSymbols = String(url.searchParams.get("symbols") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!rawSymbols.length) {
      sendJson(res, 400, { ok: false, error: "symbols query param is required" });
      return;
    }
    const limit = Number(url.searchParams.get("limit") || "6");
    const result = await fetchMarketIntelForSymbols(rawSymbols, limit);
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if ((url.pathname === "/api/mt4/ai/complete" || url.pathname === "/api/mt4/ai/complete/") && req.method === "POST") {
    const payload = await parseJsonBody(req);
    const result = await generateAiCompletion({
      prompt: payload.prompt,
      system: payload.system,
      temperature: payload.temperature,
    });
    sendJson(res, result.ok ? 200 : result.status || 502, result);
    return;
  }

  if ((url.pathname === "/api/mt4/headless/status" || url.pathname === "/api/mt4/headless/status/") && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...headlessTrader.getStatus() });
    return;
  }

  if ((url.pathname === "/api/mt4/headless/config" || url.pathname === "/api/mt4/headless/config/") && req.method === "POST") {
    const payload = await parseJsonBody(req);
    const result = await headlessTrader.updateConfig(payload);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if ((url.pathname === "/api/mt4/headless/scan-now" || url.pathname === "/api/mt4/headless/scan-now/") && req.method === "POST") {
    const result = await headlessTrader.runAutoScan();
    sendJson(res, result.ok ? 200 : 502, {
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error || "Headless scan failed" }),
      ...headlessTrader.getStatus(),
    });
    return;
  }

  if ((url.pathname === "/api/mt4/headless/protect-now" || url.pathname === "/api/mt4/headless/protect-now/") && req.method === "POST") {
    const result = await headlessTrader.runProtectLoop();
    sendJson(res, result.ok ? 200 : 502, {
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error || "Headless protect failed" }),
      ...headlessTrader.getStatus(),
    });
    return;
  }

  if (url.pathname === "/api/mt4/orders/prepare" && req.method === "POST") {
    const payload = await parseJsonBody(req);
    const validation = validateOrderRequest(payload);

    if (!validation.ok) {
      sendJson(res, 400, validation);
      return;
    }

    if (validation.request.action === "PLACE" || validation.request.action === "PENDING") {
      const resolved = await resolveExecutableSymbol(validation.request.symbol);
      if (!resolved.ok) {
        sendJson(res, 400, { ok: false, error: resolved.error || "Failed to resolve broker symbol" });
        return;
      }
      validation.request.symbol = resolved.symbol;
      if (!validateAllowedSymbol(validation.request.symbol)) {
        sendJson(res, 400, { ok: false, error: `symbol ${validation.request.symbol} is not allowed` });
        return;
      }
    }

    const riskCheck = await enforcePlaceRiskPolicy(validation.request);
    if (!riskCheck.ok) {
      sendJson(res, 400, riskCheck);
      return;
    }

    const requestId = randomUUID();
    const confirmToken = randomUUID().slice(0, 8).toUpperCase();

    pendingOrders.set(requestId, {
      requestId,
      confirmToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + MT4_CONFIRM_TTL_MS,
      request: validation.request,
      summary: validation.summary,
    });

    sendJson(res, 200, {
      ok: true,
      requestId,
      confirmToken,
      expiresInMs: MT4_CONFIRM_TTL_MS,
      summary: validation.summary,
      limits: {
        maxLotPerOrder: MT4_MAX_LOT_PER_ORDER,
        requireSlTp: MT4_REQUIRE_SL_TP,
        allowedSymbols: MT4_ALLOWED_SYMBOLS,
        maxOpenTrades: Number.isFinite(Number(validation.request.maxOpenTrades))
          ? Math.max(1, Math.min(100, Math.floor(Number(validation.request.maxOpenTrades))))
          : MT4_MAX_OPEN_TRADES,
        maxOpenPerSymbol: MT4_MAX_OPEN_PER_SYMBOL,
        minRR: MT4_MIN_RR,
        symbolCooldownSec: MT4_SYMBOL_COOLDOWN_SEC,
        dailyLossLimitPct: MT4_DAILY_LOSS_LIMIT_PCT,
      },
    });
    return;
  }

  if (url.pathname === "/api/mt4/orders/policy-check" && req.method === "POST") {
    const payload = await parseJsonBody(req);
    const validation = validateOrderRequest(payload);
    if (!validation.ok) {
      sendJson(res, 400, validation);
      return;
    }

    if (validation.request.action === "PLACE" || validation.request.action === "PENDING") {
      const resolved = await resolveExecutableSymbol(validation.request.symbol);
      if (!resolved.ok) {
        sendJson(res, 400, { ok: false, error: resolved.error || "Failed to resolve broker symbol" });
        return;
      }
      validation.request.symbol = resolved.symbol;
      if (!validateAllowedSymbol(validation.request.symbol)) {
        sendJson(res, 400, { ok: false, error: `symbol ${validation.request.symbol} is not allowed` });
        return;
      }
    }

    const evaluation = await evaluatePlaceRiskPolicy(validation.request);
    sendJson(res, 200, {
      ok: true,
      action: validation.request.action,
      checks: evaluation.checks,
      pass: evaluation.ok,
    });
    return;
  }

  if (url.pathname === "/api/mt4/orders/confirm" && req.method === "POST") {
    const payload = await parseJsonBody(req);
    const requestId = String(payload.requestId || "").trim();
    const confirmToken = String(payload.confirmToken || "").trim().toUpperCase();

    if (!requestId || !confirmToken) {
      sendJson(res, 400, { ok: false, error: "requestId and confirmToken are required" });
      return;
    }

    const pending = pendingOrders.get(requestId);
    if (!pending) {
      sendJson(res, 404, { ok: false, error: "Pending request not found" });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingOrders.delete(requestId);
      sendJson(res, 410, { ok: false, error: "Pending request expired" });
      return;
    }

    if (pending.confirmToken !== confirmToken) {
      sendJson(res, 403, { ok: false, error: "Invalid confirmToken" });
      return;
    }

    pendingOrders.delete(requestId);
    const executionRequest = { ...pending.request, id: requestId };
    const result = await executeMt4Command(executionRequest);
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (url.pathname === "/api/mt5/candles" && req.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim();
    const timeframe = (url.searchParams.get("timeframe") || "D1").trim().toUpperCase();
    const count = Number(url.searchParams.get("count") || "300");

    if (!symbol) {
      sendJson(res, 400, { ok: false, error: "symbol is required" });
      return;
    }

    const result = await runFetcher({
      symbol,
      timeframe,
      count: Number.isFinite(count) ? Math.max(50, Math.min(2000, count)) : 300,
    });

    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[market-bridge] request handler error:", err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    try {
      res.end();
    } catch {
      // no-op
    }
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[market-bridge] listening on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err?.code !== "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error("[market-bridge] failed to start:", err);
    process.exit(1);
  }

  let pidHint = "";
  try {
    if (process.platform === "win32") {
      const raw = execSync(`netstat -ano | findstr :${PORT}`, { encoding: "utf8" });
      const firstLine = raw.split(/\r?\n/).find((line) => line.trim().length > 0) || "";
      const parts = firstLine.trim().split(/\s+/);
      const procId = parts[parts.length - 1];
      if (/^\d+$/.test(procId)) pidHint = `\nTry: Stop-Process -Id ${procId} -Force`;
    } else {
      pidHint = `\nTry: lsof -ti :${PORT} | xargs kill -9`;
    }
  } catch {
    // best effort only
  }

  // eslint-disable-next-line no-console
  console.error(
    `[market-bridge] port ${PORT} is already in use.${pidHint}\n` +
      "Or set MT5_BRIDGE_PORT to a different port and restart bridge + dev server."
  );
  process.exit(1);
});
