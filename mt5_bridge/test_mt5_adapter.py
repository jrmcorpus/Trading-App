import unittest
from types import SimpleNamespace

from mt5_bridge.mt5_adapter import dispatch


class FakeMt5:
    TIMEFRAME_M1 = 1
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_TYPE_BUY_LIMIT = 2
    ORDER_TYPE_SELL_LIMIT = 3
    ORDER_TYPE_BUY_STOP = 4
    ORDER_TYPE_SELL_STOP = 5
    POSITION_TYPE_BUY = 0
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_PENDING = 5
    TRADE_ACTION_SLTP = 6
    ORDER_TIME_GTC = 0
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    ORDER_FILLING_RETURN = 2
    COPY_TICKS_ALL = 7

    def __init__(self):
        self.order_check_calls = []
        self.order_send_calls = []

    def terminal_info(self):
        return SimpleNamespace(name="Fake MT5", build=6230, connected=True, trade_allowed=True)

    def account_info(self):
        return SimpleNamespace(
            balance=100.0,
            equity=99.5,
            margin=1.0,
            margin_free=98.5,
            leverage=1000,
            login=123,
            currency="USD",
        )

    def symbol_info(self, symbol):
        if symbol.upper() not in {"EURUSD", "EURUSDM"}:
            return None
        return SimpleNamespace(
            name=symbol,
            visible=True,
            trade_contract_size=100000,
            digits=5,
            point=0.00001,
            trade_tick_value=1.0,
            trade_tick_size=0.00001,
            volume_min=0.01,
            volume_max=10.0,
            volume_step=0.01,
            filling_mode=2,
            trade_mode=4,
        )

    def symbols_get(self):
        return [self.symbol_info("EURUSD")]

    def symbol_select(self, symbol, enabled):
        return True

    def symbol_info_tick(self, symbol):
        return SimpleNamespace(symbol=symbol, bid=1.10000, ask=1.10020, time=1700000000)

    def copy_rates_from_pos(self, symbol, timeframe, start, count):
        return [
            {
                "time": 1700000000,
                "open": 1.099,
                "high": 1.101,
                "low": 1.098,
                "close": 1.100,
                "tick_volume": 12,
            }
        ]

    def copy_ticks_from(self, symbol, start, count, flags):
        return [SimpleNamespace(symbol=symbol, bid=1.1, ask=1.1002, time=1700000000)]

    def positions_get(self, ticket=None):
        position = SimpleNamespace(
            ticket=77,
            symbol="EURUSD",
            type=self.POSITION_TYPE_BUY,
            volume=0.1,
            price_open=1.099,
            sl=1.095,
            tp=1.110,
            time=1700000000,
            profit=0.5,
            comment="test",
            magic=44001,
        )
        return [position] if ticket in (None, 77) else []

    def history_deals_get(self, start, end):
        return []

    def order_check(self, request):
        self.order_check_calls.append(request)
        return SimpleNamespace(retcode=0, comment="Done")

    def order_send(self, request):
        self.order_send_calls.append(request)
        return SimpleNamespace(retcode=10009, comment="Done", order=88, deal=89, price=1.1002)


class BrokerSuffixFake(FakeMt5):
    def symbol_info(self, symbol):
        normalized = symbol.upper()
        if normalized == "EURUSD":
            return SimpleNamespace(
                name="EURUSD",
                visible=True,
                trade_contract_size=100000,
                digits=5,
                point=0.00001,
                trade_tick_value=1.0,
                trade_tick_size=0.00001,
                volume_min=0.01,
                volume_max=10.0,
                volume_step=0.01,
                filling_mode=2,
                trade_mode=0,
            )
        if normalized == "EURUSD#":
            return SimpleNamespace(
                name="EURUSD#",
                visible=True,
                trade_contract_size=100000,
                digits=5,
                point=0.00001,
                trade_tick_value=1.0,
                trade_tick_size=0.00001,
                volume_min=0.01,
                volume_max=10.0,
                volume_step=0.01,
                filling_mode=2,
                trade_mode=4,
            )
        return None

    def symbols_get(self):
        return [self.symbol_info("EURUSD"), self.symbol_info("EURUSD#")]


class StaleHistoryFake(FakeMt5):
    def copy_ticks_from(self, symbol, start, count, flags):
        return [SimpleNamespace(symbol=symbol, bid=1.05, ask=1.0502, time=1600000000)]

    def symbol_info_tick(self, symbol):
        return SimpleNamespace(symbol=symbol, bid=1.15, ask=1.1502, time=1700000000)


class Mt5AdapterTests(unittest.TestCase):
    def test_market_snapshot_combines_candles_and_current_tick(self):
        result = dispatch(
            {"action": "market", "symbol": "EURUSD", "timeframe": "M1", "count": 50},
            FakeMt5(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["symbol"], "EURUSD")
        self.assertEqual(result["tick"]["symbol"], "EURUSD")
        self.assertEqual(len(result["candles"]), 1)

    def test_market_data_skips_disabled_plain_symbol_for_broker_hash_variant(self):
        fake = BrokerSuffixFake()

        candles = dispatch(
            {"action": "candles", "symbol": "EURUSD", "timeframe": "M1", "count": 50},
            fake,
        )
        ticks = dispatch({"action": "ticks", "symbol": "EURUSD"}, fake)

        self.assertEqual(candles["symbol"], "EURUSD#")
        self.assertEqual(ticks["tick"]["symbol"], "EURUSD#")

    def test_ticks_prefer_current_terminal_quote_over_stale_tick_history(self):
        result = dispatch({"action": "ticks", "symbol": "EURUSD"}, StaleHistoryFake())

        self.assertEqual(result["tick"]["time"], 1700000000)
        self.assertEqual(result["tick"]["bid"], 1.15)

    def test_candles_serialize_mapping_rows_without_get_attribute_error(self):
        result = dispatch(
            {"action": "candles", "symbol": "EURUSD", "timeframe": "M1", "count": 50},
            FakeMt5(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["source"], "MT5")
        self.assertEqual(result["candles"][0]["volume"], 12.0)

    def test_health_reports_terminal_and_trade_gate(self):
        result = dispatch({"action": "health"}, FakeMt5(), trading_enabled=False)

        self.assertTrue(result["connected"])
        self.assertTrue(result["trade_allowed"])
        self.assertFalse(result["trading_enabled"])

    def test_ticks_accept_array_like_results_without_boolean_coercion(self):
        class ArrayLikeFake(FakeMt5):
            def copy_ticks_from(self, symbol, start, count, flags):
                class ArrayLike:
                    def __bool__(self):
                        raise ValueError("ambiguous array truth value")

                    def __iter__(self):
                        return iter([SimpleNamespace(symbol=symbol, bid=1.1, ask=1.1002, time=1700000000)])

                return ArrayLike()

        result = dispatch({"action": "ticks", "symbol": "EURUSD"}, ArrayLikeFake())

        self.assertTrue(result["ok"])
        self.assertEqual(result["tick"]["symbol"], "EURUSD")

    def test_execution_is_blocked_when_gate_is_disabled(self):
        fake = FakeMt5()
        result = dispatch(
            {
                "action": "execute",
                "request": {
                    "action": "PLACE",
                    "symbol": "EURUSD",
                    "side": "BUY",
                    "lots": 0.1,
                    "sl": 1.095,
                    "tp": 1.11,
                },
            },
            fake,
            trading_enabled=False,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "TRADING_DISABLED")
        self.assertEqual(fake.order_send_calls, [])

    def test_market_execution_checks_then_sends_native_request(self):
        fake = FakeMt5()
        result = dispatch(
            {
                "action": "execute",
                "request": {
                    "action": "PLACE",
                    "symbol": "EURUSD",
                    "side": "BUY",
                    "lots": 0.1,
                    "sl": 1.095,
                    "tp": 1.11,
                    "comment": "test-order",
                },
            },
            fake,
            trading_enabled=True,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(len(fake.order_check_calls), 1)
        self.assertEqual(len(fake.order_send_calls), 1)
        self.assertEqual(fake.order_send_calls[0]["symbol"], "EURUSD")
        self.assertEqual(fake.order_send_calls[0]["volume"], 0.1)
        self.assertEqual(fake.order_send_calls[0]["type_filling"], FakeMt5.ORDER_FILLING_IOC)

    def test_close_uses_position_ticket_and_opposite_order_type(self):
        fake = FakeMt5()
        result = dispatch(
            {"action": "execute", "request": {"action": "CLOSE", "ticket": 77}},
            fake,
            trading_enabled=True,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(fake.order_send_calls[0]["position"], 77)
        self.assertEqual(fake.order_send_calls[0]["type"], FakeMt5.ORDER_TYPE_SELL)

    def test_pending_execution_maps_pending_order_type(self):
        fake = FakeMt5()
        result = dispatch(
            {
                "action": "execute",
                "request": {
                    "action": "PENDING",
                    "symbol": "EURUSD",
                    "orderType": "BUY_LIMIT",
                    "lots": 0.1,
                    "price": 1.095,
                    "sl": 1.09,
                    "tp": 1.11,
                },
            },
            fake,
            trading_enabled=True,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(fake.order_send_calls[0]["action"], FakeMt5.TRADE_ACTION_PENDING)
        self.assertEqual(fake.order_send_calls[0]["type"], FakeMt5.ORDER_TYPE_BUY_LIMIT)

    def test_modify_execution_preserves_omitted_stop_target(self):
        fake = FakeMt5()
        result = dispatch(
            {"action": "execute", "request": {"action": "MODIFY", "ticket": 77, "sl": 1.096}},
            fake,
            trading_enabled=True,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(fake.order_send_calls[0]["action"], FakeMt5.TRADE_ACTION_SLTP)
        self.assertEqual(fake.order_send_calls[0]["position"], 77)
        self.assertEqual(fake.order_send_calls[0]["tp"], 1.11)


if __name__ == "__main__":
    unittest.main()
