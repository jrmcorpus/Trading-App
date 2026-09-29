#!/usr/bin/env python3
"""
Fetch OHLCV candles from a local MetaTrader 5 terminal (logged-in account).
Requires: pip install MetaTrader5
"""

import argparse
import json
import os
import sys
from typing import Dict, List, Optional


TIMEFRAME_MAP: Dict[str, str] = {
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


def emit(payload: Dict, code: int = 0) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.exit(code)


def symbol_candidates(base_symbol: str) -> List[str]:
    """Return likely broker symbol variants for XM/MT5."""
    s = base_symbol.upper().replace("/", "")
    if s == "GOLD":
        return ["XAUUSD", "GOLD", "XAUUSDm", "XAUUSD.", "XAUSD"]
    if s in ("CRUDEOIL", "OIL", "WTIUSD", "XTIUSD"):
        return ["USOIL", "XTIUSD", "WTIUSD", "OIL", "USOILm"]
    if len(s) == 6 and s.isalpha():
        return [s, f"{s}m", f"{s}.", f"{s}pro"]
    return [s]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--count", type=int, default=300)
    args = parser.parse_args()

    timeframe = args.timeframe.upper()
    if timeframe not in TIMEFRAME_MAP:
        emit({"ok": False, "error": f"Unsupported timeframe: {timeframe}"}, 1)

    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception as exc:
        emit({"ok": False, "error": f"MetaTrader5 package missing: {exc}"}, 1)

    if not mt5.initialize():
        emit({"ok": False, "error": f"MT5 initialize failed: {mt5.last_error()}"}, 1)

    try:
        tf_const_name = TIMEFRAME_MAP[timeframe]
        tf_const = getattr(mt5, tf_const_name, None)
        if tf_const is None:
            emit({"ok": False, "error": f"MT5 timeframe constant not found: {tf_const_name}"}, 1)

        max_count = max(50, min(args.count, 2000))
        chosen_symbol: Optional[str] = None
        rates = None

        for candidate in symbol_candidates(args.symbol):
            mt5.symbol_select(candidate, True)
            fetched = mt5.copy_rates_from_pos(candidate, tf_const, 0, max_count)
            if fetched is not None and len(fetched) > 0:
                chosen_symbol = candidate
                rates = fetched
                break

        if rates is None or chosen_symbol is None:
            emit(
                {
                    "ok": False,
                    "error": f"No rates for symbol {args.symbol}. Check symbol name in Market Watch.",
                },
                1,
            )

        candles: List[Dict] = []
        for row in rates:
            tick_volume = row["tick_volume"] if "tick_volume" in row.dtype.names else 0
            candles.append(
                {
                    "time": int(row["time"]),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(tick_volume or 0),
                }
            )

        emit(
            {
                "ok": True,
                "source": "MT5",
                "symbol": chosen_symbol,
                "requested_symbol": args.symbol,
                "timeframe": timeframe,
                "candles": candles,
            }
        )
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
