#property strict

// Bridge Settings (data export + web app execution only)
// Note: This EA does NOT run any trading strategy by itself.
// All trade decisions come from the web app via bridge_command.csv.
//GOLDm#,SILVERm#,ETHUSD#,EURUSDm#
input int MagicNumber = 44001;
input string OrderCommentPrefix = "mt4-pro-ea";

input int BarsToExport = 500;
input int ExportEverySeconds = 1;
input bool ExportMarketWatchSymbols = true;
input string CustomSymbolList = "";

input string CommandFileName = "bridge_command.csv";
input string ResultFileName = "bridge_result.csv";
input string PositionsFileName = "bridge_positions.csv";
input string AccountFileName = "bridge_account.csv";
input string HistoryFileName = "bridge_history.csv";
input string TicksFileName = "bridge_ticks.csv";
input string PolicyFileName = "bridge_policy.csv";
input string SymbolsFileName = "bridge_symbols.csv";
input bool ExportTicksEnabled = true;
input int HistoryDays = 90;
input int MaxHistoryRows = 500;
input int MaxPolicyRows = 1500;

string TFLabels[9] = {"M1","M5","M15","M30","H1","H4","D1","W1","MN"};

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

string ToUpperSafe(string value)
{
   string out = value;
   StringToUpper(out);
   return out;
}

string NormalizeSymbolSimple(string sym)
{
   string out = ToUpperSafe(sym);
   StringReplace(out, "/", "");
   StringReplace(out, ".", "");
   return out;
}

bool TrySelectTradableSymbol(string requested, string &resolved)
{
   string req = StringTrimLeft(StringTrimRight(requested));
   if(StringLen(req) <= 0) return false;

   // Fast path: exact symbol works.
   if(SymbolSelect(req, true))
   {
      resolved = req;
      return true;
   }

   string reqNorm = NormalizeSymbolSimple(req);
   if(StringLen(reqNorm) <= 0) return false;

   // Prefer visible symbols first.
   int totalVisible = SymbolsTotal(true);
   for(int i = 0; i < totalVisible; i++)
   {
      string s = SymbolName(i, true);
      if(StringLen(s) <= 0) continue;
      string norm = NormalizeSymbolSimple(s);
      if(norm == reqNorm || StringFind(norm, reqNorm, 0) == 0 || StringFind(reqNorm, norm, 0) == 0)
      {
         if(SymbolSelect(s, true))
         {
            resolved = s;
            return true;
         }
      }
   }

   // Then scan all broker symbols.
   int totalAll = SymbolsTotal(false);
   for(int j = 0; j < totalAll; j++)
   {
      string s2 = SymbolName(j, false);
      if(StringLen(s2) <= 0) continue;
      string norm2 = NormalizeSymbolSimple(s2);
      if(norm2 == reqNorm || StringFind(norm2, reqNorm, 0) == 0 || StringFind(reqNorm, norm2, 0) == 0)
      {
         if(SymbolSelect(s2, true))
         {
            resolved = s2;
            return true;
         }
      }
   }

   return false;
}

int LotDigitsFromStep(double step)
{
   int digits = 0;
   if(step <= 0) return 2;
   while(digits < 8 && MathAbs(step - NormalizeDouble(step, digits)) > 0.0000000001)
      digits++;
   return digits;
}

bool ValidateAndNormalizeLots(string sym, double requestedLots, double &normalizedLots, string &reason)
{
   if(requestedLots <= 0)
   {
      reason = "Lots must be > 0";
      return false;
   }

   double minLot = MarketInfo(sym, MODE_MINLOT);
   double maxLot = MarketInfo(sym, MODE_MAXLOT);
   double lotStep = MarketInfo(sym, MODE_LOTSTEP);
   if(minLot <= 0) minLot = 0.01;
   if(maxLot <= 0) maxLot = 100;
   if(lotStep <= 0) lotStep = 0.01;

   int lotDigits = LotDigitsFromStep(lotStep);
   double stepped = MathFloor((requestedLots / lotStep) + 0.0000001) * lotStep;
   stepped = NormalizeDouble(stepped, lotDigits);

   if(stepped > maxLot) stepped = NormalizeDouble(maxLot, lotDigits);
   if(stepped < minLot)
   {
      reason =
         "Lots " + DoubleToString(requestedLots, lotDigits) +
         " below broker min " + DoubleToString(minLot, lotDigits) +
         " (step " + DoubleToString(lotStep, lotDigits) + ")";
      return false;
   }

   normalizedLots = stepped;
   if(MathAbs(normalizedLots - requestedLots) > 0.0000001)
   {
      reason =
         "Lots normalized " + DoubleToString(requestedLots, lotDigits) +
         " -> " + DoubleToString(normalizedLots, lotDigits) +
         " (step " + DoubleToString(lotStep, lotDigits) + ")";
   }
   else
   {
      reason = "";
   }
   return true;
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

void AppendPolicyEvent(string symbol, string eventType, string severity, string detail)
{
   int handle = FileOpen(PolicyFileName, FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE)
   {
      handle = FileOpen(PolicyFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
      if(handle == INVALID_HANDLE) return;
   }

   FileSeek(handle, 0, SEEK_END);
   FileWrite(
      handle,
      IntegerToString((int)TimeCurrent()),
      symbol,
      eventType,
      severity,
      detail
   );
   FileClose(handle);

   // Keep policy file bounded.
   int rd = FileOpen(PolicyFileName, FILE_READ|FILE_CSV|FILE_ANSI, ',');
   if(rd == INVALID_HANDLE) return;

   string rows[];
   int count = 0;
   while(!FileIsEnding(rd))
   {
      string ts = FileReadString(rd);
      if(StringLen(ts) == 0) break;
      string s = FileReadString(rd);
      string e = FileReadString(rd);
      string sev = FileReadString(rd);
      string d = FileReadString(rd);
      string row = ts + "," + s + "," + e + "," + sev + "," + d;
      int next = ArraySize(rows);
      ArrayResize(rows, next + 1);
      rows[next] = row;
      count++;
   }
   FileClose(rd);

   if(count <= MaxPolicyRows) return;

   int start = count - MaxPolicyRows;
   int wr = FileOpen(PolicyFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(wr == INVALID_HANDLE) return;
   for(int i = start; i < count; i++)
   {
      string cols[];
      int n = StringSplit(rows[i], ',', cols);
      if(n >= 5) FileWrite(wr, cols[0], cols[1], cols[2], cols[3], cols[4]);
   }
   FileClose(wr);
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
      string symRaw = FileReadString(handle);
      string side = ToUpperSafe(FileReadString(handle));
      double lots = StrToDouble(FileReadString(handle));
      double sl = StrToDouble(FileReadString(handle));
      double tp = StrToDouble(FileReadString(handle));
      int deviation = (int)StrToInteger(FileReadString(handle));
      string comment = FileReadString(handle);
      FileClose(handle);

      string sym = "";
      if(!TrySelectTradableSymbol(symRaw, sym))
      {
         message = "SymbolSelect failed (" + symRaw + ")";
         AppendPolicyEvent(symRaw, "MANUAL_PLACE", "ERR", message);
      }
      else
      {
         RefreshRates();
         int type = (side == "BUY") ? OP_BUY : OP_SELL;
         double finalLots = lots;
         string lotReason = "";
         if(!ValidateAndNormalizeLots(sym, lots, finalLots, lotReason))
         {
            message = lotReason;
            AppendPolicyEvent(sym, "MANUAL_PLACE", "ERR", message);
            WriteResult(id, "ERR", message, ticket, price);
            ClearCommandFile();
            return;
         }
         price = (type == OP_BUY) ? MarketInfo(sym, MODE_ASK) : MarketInfo(sym, MODE_BID);
         ticket = OrderSend(sym, type, finalLots, price, deviation, sl, tp, comment, MagicNumber, 0, clrNONE);
         if(ticket > 0)
         {
            ok = true;
            message = "OrderSend OK";
            if(StringLen(lotReason) > 0) message = message + " | " + lotReason;
            AppendPolicyEvent(sym, "MANUAL_PLACE", "INFO", "OrderSend OK ticket=" + IntegerToString(ticket));
         }
         else
         {
            message = "OrderSend failed #" + IntegerToString(GetLastError());
            AppendPolicyEvent(sym, "MANUAL_PLACE", "ERR", message);
         }
      }
   }
   else if(action == "PENDING")
   {
      string symPRaw = FileReadString(handle);
      string orderType = ToUpperSafe(FileReadString(handle));
      double lotsP = StrToDouble(FileReadString(handle));
      double entryPrice = StrToDouble(FileReadString(handle));
      double slP = StrToDouble(FileReadString(handle));
      double tpP = StrToDouble(FileReadString(handle));
      int deviationP = (int)StrToInteger(FileReadString(handle));
      string commentP = FileReadString(handle);
      FileClose(handle);

      string symP = "";
      if(!TrySelectTradableSymbol(symPRaw, symP))
      {
         message = "SymbolSelect failed (" + symPRaw + ")";
         AppendPolicyEvent(symPRaw, "MANUAL_PENDING", "ERR", message);
      }
      else
      {
         int typeP = -1;
         if(orderType == "BUY_LIMIT") typeP = OP_BUYLIMIT;
         else if(orderType == "SELL_LIMIT") typeP = OP_SELLLIMIT;
         else if(orderType == "BUY_STOP") typeP = OP_BUYSTOP;
         else if(orderType == "SELL_STOP") typeP = OP_SELLSTOP;

         if(typeP < 0)
         {
            message = "Unknown pending order type";
         }
         else
         {
            RefreshRates();
            double finalLotsP = lotsP;
            string lotReasonP = "";
            if(!ValidateAndNormalizeLots(symP, lotsP, finalLotsP, lotReasonP))
            {
               message = lotReasonP;
               AppendPolicyEvent(symP, "MANUAL_PENDING", "ERR", message);
               WriteResult(id, "ERR", message, ticket, price);
               ClearCommandFile();
               return;
            }
            price = entryPrice;
            ticket = OrderSend(symP, typeP, finalLotsP, price, deviationP, slP, tpP, commentP, MagicNumber, 0, clrNONE);
            if(ticket > 0)
            {
               ok = true;
               message = "OrderSend OK";
               if(StringLen(lotReasonP) > 0) message = message + " | " + lotReasonP;
               AppendPolicyEvent(symP, "MANUAL_PENDING", "INFO", "OrderSend OK ticket=" + IntegerToString(ticket));
            }
            else
            {
               message = "OrderSend failed #" + IntegerToString(GetLastError());
               AppendPolicyEvent(symP, "MANUAL_PENDING", "ERR", message);
            }
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
            AppendPolicyEvent(sym, "MANUAL_CLOSE", "INFO", "OrderClose OK ticket=" + IntegerToString(reqTicket));
         }
         else
         {
            message = "OrderClose failed #" + IntegerToString(GetLastError());
            AppendPolicyEvent(sym, "MANUAL_CLOSE", "ERR", message);
         }
      }
   }
   else if(action == "MODIFY")
   {
      int reqTicket2 = (int)StrToInteger(FileReadString(handle));
      string newSLRaw = FileReadString(handle);
      string newTPRaw = FileReadString(handle);
      FileClose(handle);

      if(!OrderSelect(reqTicket2, SELECT_BY_TICKET))
      {
         message = "OrderSelect failed #" + IntegerToString(GetLastError());
      }
      else
      {
         // Keep existing SL/TP when field is omitted in command payload.
         double newSL = (StringLen(newSLRaw) > 0) ? StrToDouble(newSLRaw) : OrderStopLoss();
         double newTP = (StringLen(newTPRaw) > 0) ? StrToDouble(newTPRaw) : OrderTakeProfit();
         bool modified = OrderModify(reqTicket2, OrderOpenPrice(), newSL, newTP, 0, clrNONE);
         if(modified)
         {
            ok = true;
            ticket = reqTicket2;
            price = OrderOpenPrice();
            message = "OrderModify OK";
            AppendPolicyEvent(OrderSymbol(), "MANUAL_MODIFY", "INFO", "OrderModify OK ticket=" + IntegerToString(reqTicket2));
         }
         else
         {
            message = "OrderModify failed #" + IntegerToString(GetLastError());
            AppendPolicyEvent(OrderSymbol(), "MANUAL_MODIFY", "ERR", message);
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
      int exported = 0;
      int total = SymbolsTotal(true);
      for(int i = 0; i < total; i++)
      {
         string sym2 = SymbolName(i, true);
         if(StringLen(sym2) > 0)
         {
            ExportForSymbol(sym2);
            exported++;
         }
      }
      if(exported > 0) return;
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
      int exported = 0;
      int total = SymbolsTotal(true);
      for(int j = 0; j < total; j++)
      {
         string sym2 = SymbolName(j, true);
         if(StringLen(sym2) <= 0) continue;
         if(!SymbolSelect(sym2, true)) continue;
         RefreshRates();
         double bid2 = MarketInfo(sym2, MODE_BID);
         double ask2 = MarketInfo(sym2, MODE_ASK);
         if(bid2 > 0 && ask2 > 0)
         {
            FileWrite(handle, sym2, DoubleToString(bid2, 8), DoubleToString(ask2, 8), (int)nowTs);
            exported++;
         }
      }
      if(exported > 0)
      {
         FileClose(handle);
         return;
      }
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

void ExportSymbolSpecs()
{
   int handle = FileOpen(SymbolsFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   if(StringLen(CustomSymbolList) > 0)
   {
      string parts[];
      int n = StringSplit(CustomSymbolList, ',', parts);
      for(int i = 0; i < n; i++)
      {
         string sym = StringTrimLeft(StringTrimRight(parts[i]));
         if(StringLen(sym) <= 0) continue;
         if(!SymbolSelect(sym, true)) continue;
         double lotSize = MarketInfo(sym, MODE_LOTSIZE);
         int digits = (int)MarketInfo(sym, MODE_DIGITS);
         double point = MarketInfo(sym, MODE_POINT);
         double tickValue = MarketInfo(sym, MODE_TICKVALUE);
         double tickSize = MarketInfo(sym, MODE_TICKSIZE);
         FileWrite(handle, sym, DoubleToString(lotSize, 0), digits, DoubleToString(point, 8), DoubleToString(tickValue, 8), DoubleToString(tickSize, 8));
      }
      FileClose(handle);
      return;
   }

   if(ExportMarketWatchSymbols)
   {
      int exported = 0;
      int total = SymbolsTotal(true);
      for(int j = 0; j < total; j++)
      {
         string sym2 = SymbolName(j, true);
         if(StringLen(sym2) <= 0) continue;
         if(!SymbolSelect(sym2, true)) continue;
         double lotSize2 = MarketInfo(sym2, MODE_LOTSIZE);
         int digits2 = (int)MarketInfo(sym2, MODE_DIGITS);
         double point2 = MarketInfo(sym2, MODE_POINT);
         double tickValue2 = MarketInfo(sym2, MODE_TICKVALUE);
         double tickSize2 = MarketInfo(sym2, MODE_TICKSIZE);
         FileWrite(handle, sym2, DoubleToString(lotSize2, 0), digits2, DoubleToString(point2, 8), DoubleToString(tickValue2, 8), DoubleToString(tickSize2, 8));
         exported++;
      }
      if(exported > 0)
      {
         FileClose(handle);
         return;
      }
   }

   string sym3 = Symbol();
   if(SymbolSelect(sym3, true))
   {
      double lotSize3 = MarketInfo(sym3, MODE_LOTSIZE);
      int digits3 = (int)MarketInfo(sym3, MODE_DIGITS);
      double point3 = MarketInfo(sym3, MODE_POINT);
      double tickValue3 = MarketInfo(sym3, MODE_TICKVALUE);
      double tickSize3 = MarketInfo(sym3, MODE_TICKSIZE);
      FileWrite(handle, sym3, DoubleToString(lotSize3, 0), digits3, DoubleToString(point3, 8), DoubleToString(tickValue3, 8), DoubleToString(tickSize3, 8));
   }
   FileClose(handle);
}
int OnInit()
{
   EventSetTimer(ExportEverySeconds);
   ExportAll();
   ExportTicks();
   ExportSymbolSpecs();
   ExportOpenOrders();
   ExportAccountSnapshot();
   ExportHistoryOrders();
   AppendPolicyEvent(Symbol(), "EA_ONLINE", "INFO", "Execution EA started");
   return(INIT_SUCCEEDED);
}

void OnTick()
{
   // Bridge-only mode: orders are executed via ProcessCommand().
   // Keep OnTick empty to avoid EA-side auto-trading.
}

void OnTimer()
{
   ProcessCommand();
   ExportAll();
   ExportTicks();
   ExportSymbolSpecs();
   ExportOpenOrders();
   ExportAccountSnapshot();
   ExportHistoryOrders();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   AppendPolicyEvent(Symbol(), "EA_OFFLINE", "INFO", "Execution EA stopped");
}
