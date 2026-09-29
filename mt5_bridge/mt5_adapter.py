#!/usr/bin/env python3
"""Native MetaTrader 5 adapter for the Trading-App bridge.

The Node bridge owns HTTP validation, risk policy, and confirmation tokens. This
module owns only terminal communication and conversion to JSON-safe values.

The integration follows the official MetaTrader 5 Python API:
https://www.mql5.com/en/docs/python_metatrader5
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


TIMEFRAME_NAMES = {
    "M1": "TIMEFRAME_M1",
    "M5": "TIMEFRAME_M5",
    "M15": "TIMEFRAME_M15",
    "M30": "TIMEFRAME_M30",
    "H1": "TIMEFRAME_H1",
    "H4": "TIMEFRAME_H4",
    "D1": "TIMEFRAME_D1",
    "W1": "TIMEFRAME_W1",
    "MN": "TIMEFRAME_MN1",
}

SYMBOL_CANDIDATES = {
    "GOLD": ("GOLD#", "XAUUSD#", "GOLD", "XAUUSD", "GOLDm#", "XAUUSDm#", "XAUUSDm", "XAUUSD.", "XAUSD"),
    "XAUUSD": ("XAUUSD#", "GOLD#", "XAUUSD", "GOLD", "XAUUSDm#", "GOLDm#", "XAUUSDm", "XAUUSD.", "XAUSD"),
    "SILVER": ("SILVER#", "XAGUSD#", "SILVER", "XAGUSD", "SILVERm#", "XAGUSDm#", "XAGUSDm", "XAGUSD."),
    "XAGUSD": ("XAGUSD#", "SILVER#", "XAGUSD", "SILVER", "XAGUSDm#", "SILVERm#", "XAGUSDm", "XAGUSD."),
    "CRUDEOIL": ("USOIL#", "XTIUSD#", "WTIUSD#", "OIL#", "USOIL", "XTIUSD", "WTIUSD", "OIL", "USOILm#", "USOILm"),
    "OIL": ("USOIL#", "XTIUSD#", "WTIUSD#", "OIL#", "USOIL", "XTIUSD", "WTIUSD", "OIL", "USOILm#", "USOILm"),
}

SUCCESS_RETCODES = {10008, 10009, 10010}  # PLACED, DONE, DONE_PARTIAL


class AdapterError(RuntimeError):
    """A safe, user-facing adapter failure."""


def _as_number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _json_value(value: Any) -> Any:
    """Convert named tuples and NumPy scalar values without leaking objects."""

    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if hasattr(value, "item"):
        try:
            return _json_value(value.item())
        except (TypeError, ValueError):
            pass
    if hasattr(value, "_asdict"):
        return {str(key): _json_value(item) for key, item in value._asdict().items()}
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return str(value)


def _field(row: Any, name: str, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(name, default)
    try:
        return getattr(row, name)
    except AttributeError:
        try:
            return row[name]
        except (IndexError, KeyError, TypeError):
            return default


def _normalize_token(value: Any) -> str:
    return "".join(char for char in str(value or "").upper() if char.isalnum())


def _symbol_candidates(requested: str) -> List[str]:
    raw = str(requested or "").strip().upper().replace("/", "")
    base = raw
    for suffix in ("MICRO#", "MICRO", "M#", "#", "PRO", "M", "."):
        if base.endswith(suffix) and len(base) > len(suffix):
            base = base[: -len(suffix)]
            break

    candidates: List[str] = []
    if raw.endswith("#"):
        candidates.append(raw)
    candidates.extend(SYMBOL_CANDIDATES.get(base, ()))
    if base:
        candidates.extend(
            (
                f"{base}#",
                base,
                f"{base}m#",
                f"{base}micro#",
                f"{base}m",
                f"{base}micro",
                f"{base}.",
                f"{base}pro",
            )
        )
    if raw and raw not in candidates:
        candidates.append(raw)
    return list(dict.fromkeys(candidate for candidate in candidates if candidate))


def _timeframe(mt5: Any, timeframe: str) -> Any:
    normalized = str(timeframe or "D1").upper()
    constant_name = TIMEFRAME_NAMES.get(normalized)
    if not constant_name or not hasattr(mt5, constant_name):
        raise AdapterError(f"Unsupported timeframe: {normalized}")
    return getattr(mt5, constant_name)


def _timestamp(value: Any) -> int:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return _as_int(value)


def _utc_window(days: int) -> Tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    return end - timedelta(days=max(1, min(int(days), 3650))), end


def _error_from_mt5(mt5: Any, prefix: str) -> AdapterError:
    try:
        error = mt5.last_error()
        if isinstance(error, tuple) and len(error) >= 2:
            return AdapterError(f"{prefix}: {error[0]} {error[1]}")
        return AdapterError(f"{prefix}: {error}")
    except Exception:
        return AdapterError(prefix)


def _initialize(mt5: Any) -> None:
    path = str(os.getenv("MT5_TERMINAL_PATH", "")).strip()
    kwargs: Dict[str, Any] = {}
    login = str(os.getenv("MT5_LOGIN", "")).strip()
    password = str(os.getenv("MT5_PASSWORD", "")).strip()
    server = str(os.getenv("MT5_SERVER", "")).strip()
    # A blank server means "use the already logged-in terminal session".
    # Passing login/password without a server creates an invalid partial login
    # request for some MT5 builds, so only send explicit credentials together.
    if login and password and server:
        kwargs["login"] = int(login)
        kwargs["password"] = password
        kwargs["server"] = server
    timeout = str(os.getenv("MT5_TIMEOUT_MS", "60000")).strip()
    try:
        kwargs["timeout"] = int(timeout)
    except ValueError:
        kwargs["timeout"] = 60000

    initialized = mt5.initialize(path, **kwargs) if path else mt5.initialize(**kwargs)
    if not initialized:
        raise _error_from_mt5(mt5, "MT5 initialize failed")


def _resolve_symbol(mt5: Any, requested: str, require_tradable: bool = True) -> Tuple[str, Any]:
    raw = str(requested or "").strip()
    if not raw:
        raise AdapterError("symbol is required")

    for candidate in _symbol_candidates(raw):
        info = mt5.symbol_info(candidate)
        if info is not None:
            if require_tradable and _as_int(_field(info, "trade_mode", 0)) == 0:
                continue
            selected = mt5.symbol_select(candidate, True)
            if not bool(_field(info, "visible", True)) and not selected:
                continue
            return str(_field(info, "name", candidate)), info

    requested_token = _normalize_token(raw)
    try:
        all_symbols = mt5.symbols_get() or []
    except Exception as exc:
        raise AdapterError(f"Unable to enumerate MT5 symbols: {exc}") from None

    scored: List[Tuple[int, int, str, Any]] = []
    for info in all_symbols:
        name = str(_field(info, "name", "")).strip()
        token = _normalize_token(name)
        if not name or not token:
            continue
        if require_tradable and _as_int(_field(info, "trade_mode", 0)) == 0:
            continue
        if token == requested_token:
            score = 100
        elif token.startswith(requested_token) or requested_token.startswith(token):
            score = 80
        elif requested_token and requested_token in token:
            score = 50
        else:
            continue
        scored.append((score, -abs(len(token) - len(requested_token)), name, info))

    if not scored:
        raise AdapterError(f"MT5 symbol not found: {raw}")

    _, _, name, info = sorted(scored, reverse=True)[0]
    selected = mt5.symbol_select(name, True)
    if not bool(_field(info, "visible", True)) and not selected:
        raise AdapterError(f"MT5 symbol is unavailable in Market Watch: {name}")
    return name, info


def _symbol_spec(mt5: Any, info: Any) -> Dict[str, Any]:
    name = str(_field(info, "name", ""))
    return {
        "symbol": name,
        "lotSize": _as_number(_field(info, "trade_contract_size", 0)),
        "digits": _as_int(_field(info, "digits", 0)),
        "point": _as_number(_field(info, "point", 0)),
        "tickValue": _as_number(_field(info, "trade_tick_value", 0)),
        "tickSize": _as_number(_field(info, "trade_tick_size", 0)),
        "volumeMin": _as_number(_field(info, "volume_min", 0)),
        "volumeMax": _as_number(_field(info, "volume_max", 0)),
        "volumeStep": _as_number(_field(info, "volume_step", 0)),
        "fillingMode": _as_int(_field(info, "filling_mode", 0)),
        "tradeMode": _as_int(_field(info, "trade_mode", 0)),
        "visible": bool(_field(info, "visible", False)),
    }


def _account(mt5: Any) -> Dict[str, Any]:
    info = mt5.account_info()
    if info is None:
        raise _error_from_mt5(mt5, "MT5 account_info failed")
    return {
        "balance": _as_number(_field(info, "balance")),
        "equity": _as_number(_field(info, "equity")),
        "margin": _as_number(_field(info, "margin")),
        "freeMargin": _as_number(_field(info, "margin_free")),
        "leverage": _as_int(_field(info, "leverage")),
        "login": _as_int(_field(info, "login")),
        "currency": str(_field(info, "currency", "USD")),
        "timestamp": int(time.time()),
    }


def _position_type(mt5: Any, value: Any) -> str:
    return "BUY" if _as_int(value) == _as_int(getattr(mt5, "POSITION_TYPE_BUY", 0)) else "SELL"


def _positions(mt5: Any) -> List[Dict[str, Any]]:
    rows = mt5.positions_get()
    if rows is None:
        raise _error_from_mt5(mt5, "MT5 positions_get failed")
    return [
        {
            "ticket": _as_int(_field(row, "ticket")),
            "symbol": str(_field(row, "symbol", "")),
            "type": _position_type(mt5, _field(row, "type")),
            "lots": _as_number(_field(row, "volume")),
            "openPrice": _as_number(_field(row, "price_open")),
            "sl": _as_number(_field(row, "sl")),
            "tp": _as_number(_field(row, "tp")),
            "openTime": _timestamp(_field(row, "time")),
            "profit": _as_number(_field(row, "profit")),
            "comment": str(_field(row, "comment", "")),
            "magic": _as_int(_field(row, "magic")),
        }
        for row in rows
    ]


def _history(mt5: Any, days: int = 90, limit: int = 500) -> List[Dict[str, Any]]:
    start, end = _utc_window(days)
    deals = mt5.history_deals_get(start, end)
    if deals is None:
        raise _error_from_mt5(mt5, "MT5 history_deals_get failed")

    entry_in = _as_int(getattr(mt5, "DEAL_ENTRY_IN", 0))
    entry_out = _as_int(getattr(mt5, "DEAL_ENTRY_OUT", 1))
    grouped: Dict[int, List[Any]] = {}
    for deal in deals:
        position_id = _as_int(_field(deal, "position_id"), _as_int(_field(deal, "ticket")))
        grouped.setdefault(position_id, []).append(deal)

    trades: List[Dict[str, Any]] = []
    for position_id, rows in grouped.items():
        rows = sorted(rows, key=lambda row: _timestamp(_field(row, "time")))
        opening = next((row for row in rows if _as_int(_field(row, "entry")) == entry_in), rows[0])
        closing_rows = [row for row in rows if _as_int(_field(row, "entry")) == entry_out]
        closing = closing_rows[-1] if closing_rows else rows[-1]
        close_time = _timestamp(_field(closing, "time")) if closing_rows else 0
        profit = sum(
            _as_number(_field(row, "profit"))
            + _as_number(_field(row, "swap"))
            + _as_number(_field(row, "commission"))
            for row in rows
        )
        trades.append(
            {
                "ticket": position_id,
                "symbol": str(_field(opening, "symbol", _field(closing, "symbol", ""))),
                "type": _position_type(mt5, _field(opening, "type")),
                "lots": _as_number(_field(opening, "volume")),
                "openPrice": _as_number(_field(opening, "price")),
                "sl": 0.0,
                "tp": 0.0,
                "closePrice": _as_number(_field(closing, "price")) if closing_rows else 0.0,
                "profit": profit,
                "openTime": _timestamp(_field(opening, "time")),
                "closeTime": close_time,
                "comment": str(_field(opening, "comment", _field(closing, "comment", ""))),
            }
        )

    trades.sort(key=lambda item: (item["closeTime"], item["openTime"]), reverse=True)
    return trades[: max(1, min(int(limit), 5000))]


def _ticks(mt5: Any, symbol: Optional[str], count: int = 100) -> Dict[str, Any]:
    requested = symbol or ""
    resolved, _ = _resolve_symbol(mt5, requested) if requested else (None, None)
    selected = resolved or requested
    converted: List[Dict[str, Any]] = []
    if selected:
        current = mt5.symbol_info_tick(selected)
        if current is not None:
            current_row = {
                "symbol": selected,
                "bid": _as_number(_field(current, "bid")),
                "ask": _as_number(_field(current, "ask")),
                "time": _timestamp(_field(current, "time")),
            }
            if current_row["bid"] > 0 or current_row["ask"] > 0:
                converted = [current_row]

    if not converted and selected and hasattr(mt5, "copy_ticks_from"):
        start = datetime.now(timezone.utc) - timedelta(days=7)
        flags = getattr(mt5, "COPY_TICKS_ALL", 0)
        fetched_ticks = mt5.copy_ticks_from(selected, start, max(1, min(int(count), 1000)), flags)
        ticks: Sequence[Any] = [] if fetched_ticks is None else fetched_ticks
        converted = [
            {
                "symbol": selected,
                "bid": _as_number(_field(row, "bid")),
                "ask": _as_number(_field(row, "ask")),
                "time": _timestamp(_field(row, "time")),
            }
            for row in ticks
        ]
        converted = [row for row in converted if row["bid"] > 0 or row["ask"] > 0]

    if not converted and selected:
        tick = mt5.symbol_info_tick(selected)
        if tick is None:
            raise _error_from_mt5(mt5, f"MT5 tick unavailable for {selected}")
        converted = [
            {
                "symbol": selected,
                "bid": _as_number(_field(tick, "bid")),
                "ask": _as_number(_field(tick, "ask")),
                "time": _timestamp(_field(tick, "time")),
            }
        ]

    converted.sort(key=lambda row: row["time"], reverse=True)
    return {"ticks": converted, "tick": converted[0] if converted else None}


def _symbols(mt5: Any, symbol: Optional[str]) -> Dict[str, Any]:
    if symbol:
        _, info = _resolve_symbol(mt5, symbol)
        return {"spec": _symbol_spec(mt5, info), "specs": [_symbol_spec(mt5, info)]}

    rows = mt5.symbols_get() or []
    specs = [_symbol_spec(mt5, row) for row in rows]
    return {"specs": specs}


def _round_price(value: Optional[float], digits: int) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), max(0, int(digits)))


def _normalize_volume(value: Any, info: Any) -> float:
    requested = _as_number(value)
    minimum = _as_number(_field(info, "volume_min"))
    maximum = _as_number(_field(info, "volume_max"))
    step = _as_number(_field(info, "volume_step")) or minimum or 0.01
    if requested <= 0:
        raise AdapterError("volume must be greater than zero")
    if minimum > 0 and requested < minimum:
        raise AdapterError(f"volume {requested} is below MT5 minimum {minimum}")
    if maximum > 0 and requested > maximum:
        raise AdapterError(f"volume {requested} exceeds MT5 maximum {maximum}")
    units = round(requested / step)
    normalized = units * step
    if minimum > 0 and normalized < minimum:
        raise AdapterError(f"volume {requested} cannot be represented by MT5 step {step}")
    return round(normalized, 8)


def _filling_mode(mt5: Any, info: Any, pending: bool = False) -> int:
    if pending:
        return _as_int(getattr(mt5, "ORDER_FILLING_RETURN", 2))
    mode = _as_int(_field(info, "filling_mode", 0))
    if mode & 2:  # SYMBOL_FILLING_IOC flag -> ORDER_FILLING_IOC enum
        return _as_int(getattr(mt5, "ORDER_FILLING_IOC", 1))
    if mode & 1:  # SYMBOL_FILLING_FOK flag -> ORDER_FILLING_FOK enum
        return _as_int(getattr(mt5, "ORDER_FILLING_FOK", 0))
    return _as_int(getattr(mt5, "ORDER_FILLING_RETURN", 2))


def _trade_request(mt5: Any, request: Mapping[str, Any]) -> Dict[str, Any]:
    action = str(request.get("action", "")).upper()
    if action not in {"PLACE", "PENDING", "CLOSE", "MODIFY"}:
        raise AdapterError("action must be PLACE, PENDING, CLOSE, or MODIFY")

    magic = _as_int(os.getenv("MT5_MAGIC", "44001"), 44001)
    deviation = max(0, _as_int(request.get("deviation", 20), 20))

    if action in {"PLACE", "PENDING"}:
        symbol = str(request.get("symbol", "")).strip()
        if not symbol:
            raise AdapterError("symbol is required")
        resolved, info = _resolve_symbol(mt5, symbol, require_tradable=True)
        tick = mt5.symbol_info_tick(resolved)
        if tick is None:
            raise _error_from_mt5(mt5, f"MT5 tick unavailable for {resolved}")
        digits = _as_int(_field(info, "digits"))
        volume = _normalize_volume(request.get("lots"), info)
        side = str(request.get("side", "")).upper()
        order_type_name = str(request.get("orderType", "")).upper()
        type_map = {
            "BUY": getattr(mt5, "ORDER_TYPE_BUY"),
            "SELL": getattr(mt5, "ORDER_TYPE_SELL"),
            "BUY_LIMIT": getattr(mt5, "ORDER_TYPE_BUY_LIMIT"),
            "SELL_LIMIT": getattr(mt5, "ORDER_TYPE_SELL_LIMIT"),
            "BUY_STOP": getattr(mt5, "ORDER_TYPE_BUY_STOP"),
            "SELL_STOP": getattr(mt5, "ORDER_TYPE_SELL_STOP"),
        }
        type_name = side if action == "PLACE" else order_type_name
        if type_name not in type_map:
            raise AdapterError(f"unsupported MT5 order type: {type_name}")
        order_type = type_map[type_name]
        is_buy = type_name.startswith("BUY")
        price = (
            _as_number(_field(tick, "ask" if is_buy else "bid"))
            if action == "PLACE"
            else _as_number(request.get("price"))
        )
        if price <= 0:
            raise AdapterError("order price must be greater than zero")
        return {
            "action": getattr(mt5, "TRADE_ACTION_DEAL" if action == "PLACE" else "TRADE_ACTION_PENDING"),
            "symbol": resolved,
            "volume": volume,
            "type": order_type,
            "price": _round_price(price, digits),
            "sl": _round_price(_as_number(request.get("sl")) if request.get("sl") is not None else None, digits),
            "tp": _round_price(_as_number(request.get("tp")) if request.get("tp") is not None else None, digits),
            "deviation": deviation,
            "magic": magic,
            "comment": str(request.get("comment") or "web-bridge")[:31],
            "type_time": getattr(mt5, "ORDER_TIME_GTC"),
            "type_filling": _filling_mode(mt5, info, pending=action == "PENDING"),
        }

    ticket = _as_int(request.get("ticket"))
    if ticket <= 0:
        raise AdapterError("valid position ticket is required")
    positions = mt5.positions_get(ticket=ticket) or []
    position = next((row for row in positions if _as_int(_field(row, "ticket")) == ticket), None)
    if position is None:
        raise AdapterError(f"MT5 position not found: {ticket}")
    symbol = str(_field(position, "symbol", ""))
    _, info = _resolve_symbol(mt5, symbol, require_tradable=False)
    digits = _as_int(_field(info, "digits"))

    if action == "MODIFY":
        sl_value = request.get("sl") if request.get("sl") is not None else _field(position, "sl")
        tp_value = request.get("tp") if request.get("tp") is not None else _field(position, "tp")
        return {
            "action": getattr(mt5, "TRADE_ACTION_SLTP"),
            "symbol": symbol,
            "position": ticket,
            "sl": _round_price(_as_number(sl_value) if sl_value is not None else None, digits),
            "tp": _round_price(_as_number(tp_value) if tp_value is not None else None, digits),
            "magic": magic,
        }

    position_type = _as_int(_field(position, "type"))
    is_buy = position_type == _as_int(getattr(mt5, "POSITION_TYPE_BUY", 0))
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise _error_from_mt5(mt5, f"MT5 tick unavailable for {symbol}")
    return {
        "action": getattr(mt5, "TRADE_ACTION_DEAL"),
        "symbol": symbol,
        "volume": min(_as_number(request.get("lots")) if request.get("lots") is not None else _as_number(_field(position, "volume")), _as_number(_field(position, "volume"))),
        "type": getattr(mt5, "ORDER_TYPE_SELL" if is_buy else "ORDER_TYPE_BUY"),
        "price": _round_price(_as_number(_field(tick, "bid" if is_buy else "ask")), digits),
        "deviation": deviation,
        "magic": magic,
        "comment": "web-bridge-close",
        "type_time": getattr(mt5, "ORDER_TIME_GTC"),
        "type_filling": _filling_mode(mt5, info),
        "position": ticket,
    }


def _result_payload(result: Any) -> Dict[str, Any]:
    if result is None:
        return {}
    return _json_value(result)


def _execute(mt5: Any, request: Mapping[str, Any], trading_enabled: bool) -> Dict[str, Any]:
    if not trading_enabled:
        return {
            "ok": False,
            "status": "TRADING_DISABLED",
            "message": "Native MT5 trading is disabled. Set MT5_TRADING_ENABLED=true after validation.",
        }

    trade_request = _trade_request(mt5, request)
    checked = mt5.order_check(trade_request)
    if checked is None:
        raise _error_from_mt5(mt5, "MT5 order_check failed")
    check_retcode = _as_int(_field(checked, "retcode"), -1)
    if check_retcode != 0:
        return {
            "ok": False,
            "status": "ORDER_CHECK_FAILED",
            "message": str(_field(checked, "comment", "MT5 order_check rejected the request")),
            "retcode": check_retcode,
            "check": _result_payload(checked),
        }

    result = mt5.order_send(trade_request)
    if result is None:
        raise _error_from_mt5(mt5, "MT5 order_send failed")
    retcode = _as_int(_field(result, "retcode"), -1)
    ok = retcode in SUCCESS_RETCODES
    return {
        "ok": ok,
        "status": "OK" if ok else "ORDER_SEND_FAILED",
        "message": str(_field(result, "comment", "MT5 order accepted" if ok else "MT5 order rejected")),
        "ticket": _as_int(_field(result, "order"), _as_int(_field(result, "deal"))) or None,
        "price": _as_number(_field(result, "price")) or None,
        "retcode": retcode,
        "result": _result_payload(result),
    }


def dispatch(payload: Mapping[str, Any], mt5: Any, trading_enabled: bool = False) -> Dict[str, Any]:
    """Dispatch one request using an injected MT5 module for unit testing."""

    action = str(payload.get("action", "")).strip().lower()
    if action == "health":
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if terminal is None or account is None:
            raise _error_from_mt5(mt5, "MT5 terminal/account unavailable")
        return {
            "ok": True,
            "connected": bool(_field(terminal, "connected", False)),
            "terminal": str(_field(terminal, "name", "MetaTrader 5")),
            "build": _as_int(_field(terminal, "build")),
            "trade_allowed": bool(_field(terminal, "trade_allowed", False)),
            "account_login": _as_int(_field(account, "login")),
            "account_currency": str(_field(account, "currency", "USD")),
            "trading_enabled": bool(trading_enabled),
            "timestamp": int(time.time()),
        }
    if action == "candles":
        symbol, _ = _resolve_symbol(mt5, str(payload.get("symbol", "")))
        timeframe = str(payload.get("timeframe", "D1")).upper()
        count = max(50, min(2000, _as_int(payload.get("count"), 300)))
        rows = mt5.copy_rates_from_pos(symbol, _timeframe(mt5, timeframe), 0, count)
        if rows is None or len(rows) == 0:
            raise _error_from_mt5(mt5, f"No MT5 rates for {symbol} {timeframe}")
        candles = [
            {
                "time": _timestamp(_field(row, "time")),
                "open": _as_number(_field(row, "open")),
                "high": _as_number(_field(row, "high")),
                "low": _as_number(_field(row, "low")),
                "close": _as_number(_field(row, "close")),
                "volume": _as_number(_field(row, "tick_volume", _field(row, "real_volume", 0))),
            }
            for row in rows
        ]
        return {"ok": True, "source": "MT5", "symbol": symbol, "requested_symbol": payload.get("symbol"), "timeframe": timeframe, "candles": candles}
    if action == "account":
        return {"ok": True, "account": _account(mt5)}
    if action == "positions":
        return {"ok": True, "positions": _positions(mt5)}
    if action == "history":
        return {"ok": True, "trades": _history(mt5, _as_int(payload.get("days"), 90), _as_int(payload.get("limit"), 500))}
    if action == "ticks":
        return {"ok": True, **_ticks(mt5, str(payload.get("symbol", "")).strip() or None, _as_int(payload.get("count"), 100))}
    if action == "market":
        requested_symbol = str(payload.get("symbol", "")).strip()
        timeframe = str(payload.get("timeframe", "D1")).upper()
        count = _as_int(payload.get("count"), 300)
        candle_result = dispatch(
            {"action": "candles", "symbol": requested_symbol, "timeframe": timeframe, "count": count},
            mt5,
        )
        tick_result = dispatch(
            {"action": "ticks", "symbol": candle_result["symbol"], "count": 1},
            mt5,
        )
        return {
            "ok": True,
            "source": candle_result["source"],
            "symbol": candle_result["symbol"],
            "requested_symbol": payload.get("symbol"),
            "timeframe": timeframe,
            "candles": candle_result["candles"],
            "tick": tick_result.get("tick"),
        }
    if action == "symbols":
        return {"ok": True, **_symbols(mt5, str(payload.get("symbol", "")).strip() or None)}
    if action == "execute":
        nested_request = payload.get("request")
        request = nested_request if isinstance(nested_request, Mapping) else {key: value for key, value in payload.items() if key != "action"}
        return _execute(mt5, request, trading_enabled)
    raise AdapterError(f"Unknown MT5 adapter action: {action or 'empty'}")


def _load_mt5() -> Any:
    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception as exc:
        raise AdapterError(f"MetaTrader5 package unavailable: {exc}") from None
    return mt5


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, Mapping):
            raise AdapterError("request must be a JSON object")
        mt5 = _load_mt5()
        _initialize(mt5)
        trading_enabled = str(os.getenv("MT5_TRADING_ENABLED", "false")).strip().lower() in {"1", "true", "yes", "on"}
        response = dispatch(payload, mt5, trading_enabled=trading_enabled)
    except AdapterError as exc:
        response = {"ok": False, "error": str(exc)}
    except Exception as exc:  # pragma: no cover - final process boundary guard
        response = {"ok": False, "error": f"MT5 adapter error: {type(exc).__name__}: {exc}"}
    finally:
        try:
            if "mt5" in locals():
                mt5.shutdown()
        except Exception:
            pass

    sys.stdout.write(json.dumps(_json_value(response), separators=(",", ":")))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
