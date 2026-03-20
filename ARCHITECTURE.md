# Architecture & Design Guide

## 🏗️ Project Structure Overview

```
Trading-App/
├── src/
│   ├── components/         # React components
│   │   ├── Dashboard.tsx
│   │   ├── RiskCalculator.tsx
│   │   ├── TradingJournal.tsx
│   │   ├── MarketAnalysis.tsx
│   │   └── PortfolioManager.tsx
│   ├── utils/             # Utility functions
│   │   ├── constants.ts   # XM-specific configs
│   │   ├── calculations.ts # Risk/PnL math
│   │   └── supabase.ts    # DB operations
│   ├── types/             # TypeScript interfaces
│   │   └── index.ts
│   ├── hooks/             # Custom React hooks (future)
│   ├── App.tsx            # Main layout component
│   ├── index.tsx          # React entry point
│   └── index.css          # Global styles
├── db/
│   └── schema.sql         # Supabase DDL
├── public/                # Static assets
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── index.html
└── README.md
```

---

## 🔄 Data Flow Architecture

```
User Input (Form)
    ↓
React State (useState)
    ↓
Calculation/Validation
    ↓
Database Operation (Supabase)
    ↓
Local State Update
    ↓
Re-render Component
    ↓
Display Data
```

### Example: Add Trade
```
1. User fills TradingJournal form
2. handleSubmit() called
3. Validate inputs (required fields, numbers valid)
4. Calculate PnL if closed: pnl = pips × lotSize × 0.10
5. Call onAddTrade() callback
6. Add to trades array in App.tsx state
7. Update balance if closed trade
8. Component re-renders with new trade in table
```

---

## 📊 Database Schema Design

### Tables

#### `trades`
Stores individual trade records with complete history
```sql
- id (UUID, Primary Key)
- user_id (UUID, Foreign Key → auth.users)
- asset (VARCHAR: EURUSD, Gold, etc)
- trade_type (VARCHAR: Buy or Sell)
- entry_price (DECIMAL)
- stop_loss (DECIMAL)
- take_profit (DECIMAL)
- lot_size (DECIMAL)
- pnl_usd (DECIMAL, nullable)
- pips_gained (DECIMAL, nullable)
- emotional_state (VARCHAR)
- reasoning (TEXT) ← Critical for learning
- created_at (TIMESTAMP)
- closed_at (TIMESTAMP, nullable)
- is_closed (BOOLEAN)
```

#### `account_stats`
Aggregated performance statistics
```sql
- id (UUID, Primary Key)
- user_id (UUID, Foreign Key)
- initial_balance (DECIMAL)
- current_balance (DECIMAL)
- total_pnl (DECIMAL)
- win_count (INT)
- loss_count (INT)
- updated_at (TIMESTAMP)
```

#### `daily_snapshots`
Historical balance snapshots for growth chart
```sql
- id (UUID, Primary Key)
- user_id (UUID, Foreign Key)
- date (DATE)
- balance_snapshot (DECIMAL)
- created_at (TIMESTAMP)
```

### Relationships
```
auth.users (1) ─── (many) trades
auth.users (1) ─── (1) account_stats
auth.users (1) ─── (many) daily_snapshots
```

### Indexes (Performance)
- `trades(user_id)` - Fast user filtering
- `trades(created_at DESC)` - Latest trades first
- `trades(asset)` - Filter by currency pair
- `account_stats(user_id)` - User stats lookup
- `daily_snapshots(user_id, date)` - Growth chart data

### Security: Row-Level Security (RLS)
```sql
-- Each user can only see their own trades
CREATE POLICY "select own trades" ON trades
  FOR SELECT USING (auth.uid() = user_id);

-- Each user can only insert their own trades
CREATE POLICY "insert own trades" ON trades
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

---

## 💡 Key Design Decisions

### 1. Component Architecture

**Principle**: Single Responsibility - each component does ONE thing

- **Dashboard.tsx**: Display metrics only (no form)
- **RiskCalculator.tsx**: Position sizing only
- **TradingJournal.tsx**: Trade input + display
- **MarketAnalysis.tsx**: News and educational content
- **PortfolioManager.tsx**: Margin tracking only

**Benefit**: Easy to test, reuse, and maintain

### 2. State Management

**Decision**: Use React hooks (useState) instead of Redux

**Reasoning for micro accounts**:
- Simpler learning curve
- Fewer dependencies
- Sufficient for single-user app
- Props drilling acceptable (5 levels max)

**Future**: Add Context API if state grows complex

```typescript
// In App.tsx
const [trades, setTrades] = useState<Trade[]>([]);
const [currentBalance, setCurrentBalance] = useState(100);

// Pass down as props
<Dashboard trades={trades} currentBalance={currentBalance} />
```

### 3. Calculations Library

**Decision**: Centralize all math in `utils/calculations.ts`

**Why**: 
- Single source of truth
- Easy to verify formulas
- Testable independently
- Consistent across app

```typescript
// WRONG (scattered calculations)
const pnl = pips * lotSize * 0.10; // In component
const margin = (lot * 1000 * price) / 1000; // In another

// RIGHT (centralized)
const pnl = calculatePnL(lotSize, entry, exit, type);
const margin = calculateMarginRequired(lotSize, price);
```

### 4. Constants Pattern

**Decision**: All XM-specific values in `utils/constants.ts`

```typescript
export const MICRO_LOT_CONFIG = {
  MICRO_LOT_UNITS: 1000,
  PIP_VALUE_FULL_MICRO: 0.10,
  MIN_LOT_SIZE: 0.01,
};

// Use like:
import { MICRO_LOT_CONFIG } from '../utils/constants';
const pipValue = MICRO_LOT_CONFIG.PIP_VALUE_FULL_MICRO;
```

**Benefit**: Change one number = changes everywhere

### 5. TypeScript Strict Mode

**Enabled**:
- `strict: true` - All type checks
- `noUnusedLocals: true` - No dead code
- `noUnusedParameters: true` - Clean functions

**Forces good practices**:
- Explicit interface props
- No `any` types
- Complete error handling

### 6. Styling Approach

**Decision**: Tailwind CSS with custom tokens

```typescript
// In constants.ts
export const THEME = {
  BG_PRIMARY: "bg-slate-900",
  BG_SECONDARY: "bg-slate-800",
  PROFIT_COLOR: "text-emerald-400",
  LOSS_COLOR: "text-rose-500",
};

// Use everywhere consistently
<div className={`${THEME.BG_SECONDARY} ${THEME.PROFIT_COLOR}`}>
```

**Benefit**: Dark theme change = update one file

---

## 🔐 Security Architecture

### Authentication (Ready for Supabase Auth)
```
User Login
    ↓
Supabase Auth (JWT)
    ↓
Store token in localStorage
    ↓
Every DB request: JWT in header
    ↓
Supabase RLS checks JWT against user_id
    ↓
Only matching rows returned
```

### Data Privacy
- No PII stored except user authentication
- No credit card information
- No broker credentials stored
- All data encrypted in transit (HTTPS)

### Database Security
- RLS enforces at database level (not app level)
- Never trust client-side filtering
- Prepared statements (via Supabase)
- Rate limiting recommended

---

## 🎯 Component Interface Patterns

### Props Interface
```typescript
interface DashboardProps {
  trades: Trade[];              // Data
  currentBalance: number;       // Config
  initialBalance: number;       // Config
}

const Dashboard: React.FC<DashboardProps> = (props) => {
  // Implementation
};
```

### Callbacks
```typescript
interface TradingJournalProps {
  trades: Trade[];
  onAddTrade: (trade: Omit<Trade, 'id'>) => void; // Callback
  currentBalance: number;
}
```

**Rule**: Props flow down, callbacks flow up

---

## 📦 Dependency Management

### Core Dependencies (Minimal!)
```json
{
  "react": "^18.2.0",              // UI framework
  "react-dom": "^18.2.0",          // DOM rendering
  "lightweight-charts": "^4.1.0",  // Charts (when added)
  "@supabase/supabase-js": "^2.38" // Database
}
```

### Dev Dependencies
```json
{
  "typescript": "^5.2.0",    // Type checking
  "vite": "^4.4.0",          // Build tool
  "tailwindcss": "^3.3.0",   // Styling
  "postcss": "^8.4.30",      // CSS processing
  "@vitejs/plugin-react": "^4" // React + JSX support
}
```

**Philosophy**: Keep dependencies minimal for micro accounts context
- Less bloat
- Easier to understand
- Fewer security vulnerabilities
- Faster builds

---

## 🔄 State Update Flow

```
User Action
    ↓
Event Handler (e.g., handleSubmit)
    ↓
Validate Input
    ↓
Call Database API (if needed)
    ↓
Update State with setTrades()
    ↓
React Re-renders
    ↓
Display Updated Data
```

### Example: Add Trade
```typescript
// In TradingJournal.tsx
const handleSubmit = (e: FormEvent) => {
  e.preventDefault();
  
  // 1. Validate
  if (!formData.asset) {
    alert("Asset required");
    return;
  }
  
  // 2. Calculate PnL
  const pnl = calculatePnL(...);
  
  // 3. Create trade object
  const newTrade = { ...formData, pnl_usd: pnl };
  
  // 4. Call parent callback
  onAddTrade(newTrade);
  
  // 5. Reset form
  setFormData(initialState);
};

// In App.tsx
const handleAddTrade = (newTrade) => {
  const tradeWithId = { ...newTrade, id: uuid() };
  setTrades([...trades, tradeWithId]);       // Update state
  if (newTrade.is_closed) {
    setCurrentBalance(currentBalance + pnl); // Update balance
  }
};
```

---

## 🧪 Testing Strategy

### Unit Tests (Calculations)
```typescript
// tests/calculations.test.ts
describe('calculateLotSize', () => {
  it('should calculate correct lot size', () => {
    const lotSize = calculateLotSize(100, 1, 50);
    expect(lotSize).toBeCloseTo(0.20);
  });
});
```

### Component Tests (React)
```typescript
// tests/RiskCalculator.test.tsx
describe('RiskCalculator', () => {
  it('should render with default balance', () => {
    render(<RiskCalculator balance={100} />);
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });
});
```

### Integration Tests (E2E)
```typescript
// tests/trading-flow.e2e.ts
describe('Complete trading flow', () => {
  it('should add trade and update balance', () => {
    // 1. Log into app
    // 2. Add trade
    // 3. Check balance updated
    // 4. Check dashboard metrics
  });
});
```

---

## 🚀 Performance Optimization

### Code Splitting
```typescript
// Use lazy loading for pages
const Dashboard = lazy(() => import('./components/Dashboard'));
const RiskCalculator = lazy(() => import('./components/RiskCalculator'));

// In App.tsx
<Suspense fallback={<Spinner />}>
  {currentPage === 'dashboard' && <Dashboard />}
</Suspense>
```

### Memoization
```typescript
// Prevent unnecessary re-renders
const Dashboard = React.memo(({ trades, balance }) => {
  const metrics = useMemo(() => {
    return calculateMetrics(trades);
  }, [trades]); // Only recalculate when trades change
});
```

### Database Queries
```typescript
// Get trades for current user only
const { data } = await supabase
  .from('trades')
  .select()
  .eq('user_id', userId)           // Filter server-side
  .order('created_at', { 
    ascending: false 
  })
  .limit(100);                      // Limit results
```

---

## 📚 Design Patterns Used

### 1. Container/Presenter Pattern
```typescript
// Container: App.tsx - handles state
const App = () => {
  const [trades, setTrades] = useState([]);
  return <Dashboard trades={trades} />; // Pass to presenter
};

// Presenter: Dashboard.tsx - renders UI
const Dashboard = ({ trades }) => {
  return <table>{trades.map(...)}</table>;
};
```

### 2. Callback Pattern
```typescript
// Child components communicate via callbacks
<TradingJournal onAddTrade={handleAddTrade} />

// In child:
const handleSubmit = () => {
  onAddTrade(trade); // Notify parent
};
```

### 3. Higher-Order Components (Future)
```typescript
// Possible for auth, theme switching
const withAuth = (Component) => {
  return (props) => {
    const [auth] = useAuth();
    if (!auth) return <LoginForm />;
    return <Component {...props} />;
  };
};
```

---

## 🔮 Future Architecture Improvements

### Add Context API for Theme
```typescript
const ThemeContext = createContext();

// Wrapper
<ThemeContext.Provider value={{ theme: 'dark' }}>
  <App />
</ThemeContext.Provider>

// Usage
const { theme } = useContext(ThemeContext);
```

### Add Custom Hooks
```typescript
// hooks/useTrades.ts
function useTrades() {
  const [trades, setTrades] = useState([]);
  
  useEffect(() => {
    const subscription = supabase
      .from('trades')
      .on('*', payload => {
        setTrades(prev => [...prev, payload.new]);
      })
      .subscribe();
    
    return () => subscription.unsubscribe();
  }, []);
  
  return { trades, setTrades };
}

// Usage in component
const { trades } = useTrades();
```

### Error Boundary
```typescript
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
```

---

## 📖 Code Style Guide

### Naming Conventions
- Components: PascalCase (`Dashboard.tsx`)
- Files: PascalCase for components, camelCase for utils
- Functions: camelCase (`calculateLotSize`)
- Constants: UPPER_SNAKE_CASE (`MICRO_LOT_UNITS`)
- Private functions: `_privateFunction`

### Component Structure
```typescript
// 1. Imports
import React from 'react';
import { Type } from '../types';

// 2. Props interface
interface MyComponentProps {
  trades: Trade[];
  onSave: (trade: Trade) => void;
}

// 3. Component
const MyComponent: React.FC<MyComponentProps> = ({ trades, onSave }) => {
  // 4. State
  const [isLoading, setIsLoading] = useState(false);
  
  // 5. Effects
  useEffect(() => {
    // ...
  }, []);
  
  // 6. Handlers
  const handleClick = () => {
    // ...
  };
  
  // 7. Render
  return <div>{/* JSX */}</div>;
};

// 8. Export
export default MyComponent;
```

---

## 🎓 Learning Path for New Developers

1. **Understand the domain**: Read QUICK_START.md + trading knowledge
2. **Review architecture**: Read this file
3. **Explore components**: Start with RiskCalculator.tsx (simplest)
4. **Understand state flow**: How App.tsx manages state
5. **Add a feature**: Try adding a new calculation or UI element
6. **Write tests**: Unit test your feature
7. **Submit PR**: Follow contributing guidelines

---

## 📞 Architecture Decisions Record (ADR)

### ADR-001: Use Tailwind CSS over CSS Modules
**Status**: Decided  
**Pros**: Faster development, consistent theme, smaller bundle  
**Cons**: Large HTML class names  
**Chosen**: Tailwind CSS

### ADR-002: useState instead of Redux
**Status**: Decided  
**Pros**: Simpler for single-user app, fewer dependencies  
**Cons**: Prop drilling if grows large  
**Chosen**: useState (migrate to Context API if needed)

### ADR-003: Centralize calculations
**Status**: Decided  
**Pros**: Single source of truth, testable, maintainable  
**Cons**: Need to import from utils everywhere  
**Chosen**: calculations.ts utility file

---

**Architecture Last Updated**: February 22, 2026  
**Maintained by**: Senior Developer  
**Status**: Stable ✨
