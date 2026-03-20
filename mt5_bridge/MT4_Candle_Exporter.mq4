#property strict

input int BarsToExport = 500;
input int ExportEverySeconds = 1;
input bool ExportMarketWatchSymbols = true;
input string CustomSymbolList = ""; // Optional comma-separated symbols, e.g. EURUSD,GBPUSD,XAUUSD

input string CommandFileName = "bridge_command.csv";
input string ResultFileName = "bridge_result.csv";
input string PositionsFileName = "bridge_positions.csv";
input string AccountFileName = "bridge_account.csv";
input string HistoryFileName = "bridge_history.csv";
input string TicksFileName = "bridge_ticks.csv";
input bool ExportTicksEnabled = true;
input int HistoryDays = 90;
input int MaxHistoryRows = 500;

int TimeframeFromLabel(string tf)
{
   if(tf == "M1") return PERIOD_M1;
   if(tf == "M5") return PERIOD_M5;
   if(tf == "M15") return PERIOD_M15;
   if(tf == "M30") return PERIOD_M30;
   if(tf == "H1") return PERIOD_H1;
   if(tf == "H4") return PERIOD_H4;
   if(tf == "D1") return PERIOD_D1;
   if(tf == "W1") return PERIOD_W1;
   if(tf == "MN") return PERIOD_MN1;
   return -1;
}

string TFLabels[9] = {"M1","M5","M15","M30","H1","H4","D1","W1","MN"};

string ToUpperSafe(string value)
{
   string out = value;
   StringToUpper(out);
   return out;
}

void WriteResult(string id, string status, string message, int ticket, double price)
{
   int handle = FileOpen(ResultFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   FileWrite(handle, id, status, message, ticket, DoubleToString(price, 8), (int)TimeCurrent());
   FileClose(handle);
}

void ClearCommandFile()
{
   int h = FileOpen(CommandFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(h != INVALID_HANDLE) FileClose(h);
}

void ProcessCommand()
{
   int handle = FileOpen(CommandFileName, FILE_READ|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;
   if(FileIsEnding(handle)) { FileClose(handle); return; }

   string id = FileReadString(handle);
   string action = ToUpperSafe(FileReadString(handle));

   if(StringLen(id) == 0 || StringLen(action) == 0)
   {
      FileClose(handle);
      return;
   }

   int ticket = -1;
   double price = 0;
   string message = "";
   bool ok = false;

   if(action == "PLACE")
   {
      string sym = FileReadString(handle);
      string side = ToUpperSafe(FileReadString(handle));
      double lots = StrToDouble(FileReadString(handle));
      double sl = StrToDouble(FileReadString(handle));
      double tp = StrToDouble(FileReadString(handle));
      int deviation = (int)StrToInteger(FileReadString(handle));
      string comment = FileReadString(handle);

      FileClose(handle);

      if(!SymbolSelect(sym, true))
      {
         message = "SymbolSelect failed";
      }
      else
      {
         RefreshRates();
         int type = (side == "BUY") ? OP_BUY : OP_SELL;
         price = (type == OP_BUY) ? MarketInfo(sym, MODE_ASK) : MarketInfo(sym, MODE_BID);
         ticket = OrderSend(sym, type, lots, price, deviation, sl, tp, comment, 0, 0, clrNONE);
         if(ticket > 0)
         {
            ok = true;
            message = "OrderSend OK";
         }
         else
         {
            message = "OrderSend failed #" + IntegerToString(GetLastError());
         }
      }
   }
   else if(action == "CLOSE")
   {
      int reqTicket = (int)StrToInteger(FileReadString(handle));
      double closeLots = StrToDouble(FileReadString(handle));
      int deviationClose = (int)StrToInteger(FileReadString(handle));

      FileClose(handle);

      if(!OrderSelect(reqTicket, SELECT_BY_TICKET))
      {
         message = "OrderSelect failed #" + IntegerToString(GetLastError());
      }
      else
      {
         string sym = OrderSymbol();
         int type = OrderType();
         RefreshRates();
         double closePrice = (type == OP_BUY) ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
         if(closeLots <= 0) closeLots = OrderLots();

         bool closed = OrderClose(reqTicket, closeLots, closePrice, deviationClose, clrNONE);
         if(closed)
         {
            ok = true;
            ticket = reqTicket;
            price = closePrice;
            message = "OrderClose OK";
         }
         else
         {
            message = "OrderClose failed #" + IntegerToString(GetLastError());
         }
      }
   }
   else if(action == "MODIFY")
   {
      int reqTicket2 = (int)StrToInteger(FileReadString(handle));
      double newSL = StrToDouble(FileReadString(handle));
      double newTP = StrToDouble(FileReadString(handle));

      FileClose(handle);

      if(!OrderSelect(reqTicket2, SELECT_BY_TICKET))
      {
         message = "OrderSelect failed #" + IntegerToString(GetLastError());
      }
      else
      {
         bool modified = OrderModify(reqTicket2, OrderOpenPrice(), newSL, newTP, 0, clrNONE);
         if(modified)
         {
            ok = true;
            ticket = reqTicket2;
            price = OrderOpenPrice();
            message = "OrderModify OK";
         }
         else
         {
            message = "OrderModify failed #" + IntegerToString(GetLastError());
         }
      }
   }
   else
   {
      FileClose(handle);
      message = "Unknown action";
   }

   WriteResult(id, ok ? "OK" : "ERR", message, ticket, price);
   ClearCommandFile();
}

void ExportOpenOrders()
{
   int handle = FileOpen(PositionsFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int t = OrderType();
      if(t != OP_BUY && t != OP_SELL) continue;

      string type = (t == OP_BUY) ? "BUY" : "SELL";
      FileWrite(
         handle,
         OrderTicket(),
         OrderSymbol(),
         type,
         DoubleToString(OrderLots(), 2),
         DoubleToString(OrderOpenPrice(), 8),
         DoubleToString(OrderStopLoss(), 8),
         DoubleToString(OrderTakeProfit(), 8),
         (int)OrderOpenTime()
      );
   }

   FileClose(handle);
}

void ExportAccountSnapshot()
{
   int handle = FileOpen(AccountFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   FileWrite(
      handle,
      DoubleToString(AccountBalance(), 2),
      DoubleToString(AccountEquity(), 2),
      DoubleToString(AccountMargin(), 2),
      DoubleToString(AccountFreeMargin(), 2),
      IntegerToString(AccountLeverage()),
      IntegerToString(AccountNumber()),
      AccountCurrency(),
      (int)TimeCurrent()
   );

   FileClose(handle);
}

void ExportHistoryOrders()
{
   int handle = FileOpen(HistoryFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   datetime cutoff = TimeCurrent() - MathMax(1, HistoryDays) * 24 * 60 * 60;
   int rows = 0;

   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
   {
      if(rows >= MaxHistoryRows) break;
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;

      int t = OrderType();
      if(t != OP_BUY && t != OP_SELL) continue;
      if(OrderCloseTime() <= 0) continue;
      if(OrderCloseTime() < cutoff) continue;

      string type = (t == OP_BUY) ? "BUY" : "SELL";
      double netProfit = OrderProfit() + OrderSwap() + OrderCommission();

      FileWrite(
         handle,
         IntegerToString(OrderTicket()),
         OrderSymbol(),
         type,
         DoubleToString(OrderLots(), 2),
         DoubleToString(OrderOpenPrice(), 8),
         DoubleToString(OrderStopLoss(), 8),
         DoubleToString(OrderTakeProfit(), 8),
         DoubleToString(OrderClosePrice(), 8),
         DoubleToString(netProfit, 2),
         (int)OrderOpenTime(),
         (int)OrderCloseTime(),
         OrderComment()
      );

      rows++;
   }

   FileClose(handle);
}

void ExportSymbolTF(string sym, string tfLabel)
{
   int tf = TimeframeFromLabel(tfLabel);
   if(tf < 0) return;

   int bars = iBars(sym, tf);
   if(bars <= 0) return;

   int count = BarsToExport;
   if(count > bars) count = bars;
   if(count < 50) count = 50;

   string fileName = sym + "_" + tfLabel + ".csv";
   int handle = FileOpen(fileName, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   // Write oldest -> newest
   for(int i = count - 1; i >= 0; i--)
   {
      datetime t = iTime(sym, tf, i);
      if(t <= 0) continue;

      double o = iOpen(sym, tf, i);
      double h = iHigh(sym, tf, i);
      double l = iLow(sym, tf, i);
      double c = iClose(sym, tf, i);
      long v = iVolume(sym, tf, i);

      FileWrite(handle, (int)t, DoubleToString(o, 8), DoubleToString(h, 8), DoubleToString(l, 8), DoubleToString(c, 8), (double)v);
   }

   FileClose(handle);
}

void ExportForSymbol(string sym)
{
   if(!SymbolSelect(sym, true)) return;
   for(int i = 0; i < ArraySize(TFLabels); i++)
   {
      ExportSymbolTF(sym, TFLabels[i]);
   }
}

void ExportAll()
{
   if(StringLen(CustomSymbolList) > 0)
   {
      string parts[];
      int n = StringSplit(CustomSymbolList, ',', parts);
      for(int i = 0; i < n; i++)
      {
         string sym = StringTrimLeft(StringTrimRight(parts[i]));
         if(StringLen(sym) > 0) ExportForSymbol(sym);
      }
      return;
   }

   if(ExportMarketWatchSymbols)
   {
      int total = SymbolsTotal(true);
      for(int i = 0; i < total; i++)
      {
         string sym = SymbolName(i, true);
         if(StringLen(sym) > 0) ExportForSymbol(sym);
      }
      return;
   }

   ExportForSymbol(Symbol());
}

void ExportTicks()
{
   if(!ExportTicksEnabled) return;

   int handle = FileOpen(TicksFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   datetime nowTs = TimeCurrent();

   if(StringLen(CustomSymbolList) > 0)
   {
      string parts[];
      int n = StringSplit(CustomSymbolList, ',', parts);
      for(int i = 0; i < n; i++)
      {
         string sym = StringTrimLeft(StringTrimRight(parts[i]));
         if(StringLen(sym) <= 0) continue;
         if(!SymbolSelect(sym, true)) continue;
         RefreshRates();
         double bid = MarketInfo(sym, MODE_BID);
         double ask = MarketInfo(sym, MODE_ASK);
         if(bid > 0 && ask > 0) FileWrite(handle, sym, DoubleToString(bid, 8), DoubleToString(ask, 8), (int)nowTs);
      }
      FileClose(handle);
      return;
   }

   if(ExportMarketWatchSymbols)
   {
      int total = SymbolsTotal(true);
      for(int i = 0; i < total; i++)
      {
         string sym2 = SymbolName(i, true);
         if(StringLen(sym2) <= 0) continue;
         if(!SymbolSelect(sym2, true)) continue;
         RefreshRates();
         double bid2 = MarketInfo(sym2, MODE_BID);
         double ask2 = MarketInfo(sym2, MODE_ASK);
         if(bid2 > 0 && ask2 > 0) FileWrite(handle, sym2, DoubleToString(bid2, 8), DoubleToString(ask2, 8), (int)nowTs);
      }
      FileClose(handle);
      return;
   }

   string sym3 = Symbol();
   if(SymbolSelect(sym3, true))
   {
      RefreshRates();
      double bid3 = MarketInfo(sym3, MODE_BID);
      double ask3 = MarketInfo(sym3, MODE_ASK);
      if(bid3 > 0 && ask3 > 0) FileWrite(handle, sym3, DoubleToString(bid3, 8), DoubleToString(ask3, 8), (int)nowTs);
   }

   FileClose(handle);
}

int OnInit()
{
   EventSetTimer(ExportEverySeconds);
   ExportAll();
   ExportTicks();
   ExportOpenOrders();
   ExportAccountSnapshot();
   ExportHistoryOrders();
   return(INIT_SUCCEEDED);
}

void OnTimer()
{
   ProcessCommand();
   ExportAll();
   ExportTicks();
   ExportOpenOrders();
   ExportAccountSnapshot();
   ExportHistoryOrders();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}
