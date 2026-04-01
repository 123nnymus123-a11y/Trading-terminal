# Phase 1B Integration Guide

## Overview

This guide walks through integrating the 8 panel components with the existing `StrategyResearch.tsx` tab component and the `StrategyResearchLayout.tsx` container.

## Current State

- **StrategyResearchLayout.tsx**: Seven-panel workspace container (created in Phase 1B)
- **Panel Components**: 8 standalone components ready to integrate (created this pass)
- **StrategyResearch.tsx**: Existing 2383-line component with 4-tab layout (untouched)

## Integration Approach

### Step 1: Update StrategyResearch.tsx Imports

Add imports for all panel components:

```typescript
// Top of StrategyResearch.tsx
import { StrategyResearchLayout } from "./StrategyResearchLayout";
import { StrategyLibraryPanel } from "./StrategyLibraryPanel";
import { StudioPanel } from "./StudioPanel";
import { RunsPanel } from "./RunsPanel";
import { ReportsPanel } from "./ReportsPanel";
import { ComparePanel } from "./ComparePanel";
import { DataSourcePanel } from "./DataSourcePanel";
import { SettingsPanel } from "./SettingsPanel";
import { CLIDrawerPanel } from "./CLIDrawerPanel";
```

### Step 2: Update State Management in StrategyResearch.tsx

Replace the existing 4-tab model with 7-panel rail navigation:

```typescript
// OLD (existing)
const [activeTab, setActiveTab] = useState<
  "list" | "editor" | "runs" | "details"
>("list");

// NEW
const [activeRailItem, setActiveRailItem] = useState<
  "library" | "studio" | "runs" | "reports" | "compare" | "data" | "settings"
>("library");
const [drawerOpen, setDrawerOpen] = useState(true);
const [drawerHeight, setDrawerHeight] = useState(200);
```

### Step 3: Add Drawer/CLI State

For the CLI drawer panel:

```typescript
const [cliLogs, setCliLogs] = useState<LogEntry[]>([]);

const handleCliCommand = (command: string) => {
  // Log the command
  setCliLogs((prev) => [
    ...prev,
    {
      timestamp: new Date().toLocaleTimeString(),
      level: "info",
      message: `> ${command}`,
    },
  ]);

  // Execute command logic here
  // Could dispatch to a command processor
};

const handleClearLogs = () => {
  setCliLogs([]);
};
```

### Step 4: Render Using StrategyResearchLayout

Replace the existing tab-based render with layout container:

```typescript
// OLD render structure (4 tabs + content)
return (
  <div>
    <h2>Strategy Research</h2>
    <TabButtons activeTab={activeTab} setActiveTab={setActiveTab} />
    {activeTab === 'list' && <StrategyListView ... />}
    {activeTab === 'editor' && <CodeEditorView ... />}
    {activeTab === 'runs' && <RunHistoryView ... />}
    {activeTab === 'details' && <DetailsView ... />}
  </div>
);

// NEW render structure (7-panel layout)
return (
  <StrategyResearchLayout
    railItems={[
      { id: 'library', label: 'Library', icon: '📚', badge: undefined },
      { id: 'studio', label: 'Studio', icon: '💻', badge: undefined },
      { id: 'runs', label: 'Runs', icon: '▶', badge: pendingRuns > 0 ? pendingRuns : undefined },
      { id: 'reports', label: 'Reports', icon: '📊', badge: undefined },
      { id: 'compare', label: 'Compare', icon: '⚖', badge: selectedComparisons > 0 ? selectedComparisons : undefined },
      { id: 'data', label: 'Data', icon: '🗄', badge: undefined },
      { id: 'settings', label: 'Settings', icon: '⚙', badge: undefined },
    ]}
    activeRailItem={activeRailItem}
    onRailItemClick={(id) => setActiveRailItem(id as any)}
    centerContent={
      <CenterPanelRouter
        activeItem={activeRailItem}
        strategyStore={strategyStore}
        // ... other props
      />
    }
    rightContent={
      <RightInspectorRouter
        activeItem={activeRailItem}
        selectedStrategy={selectedStrategy}
        selectedRun={selectedRun}
        // ... other props
      />
    }
    drawerContent={
      <CLIDrawerPanel
        logs={cliLogs}
        onCommand={handleCliCommand}
        isExecuting={isCommandExecuting}
        onClearLogs={handleClearLogs}
      />
    }
    drawerHeight={drawerHeight}
    onDrawerHeightChange={setDrawerHeight}
  />
);
```

### Step 5: Create Panel Router Components

To handle switching between panels efficiently:

```typescript
// CenterPanelRouter.tsx (new file)
type CenterPanelRouterProps = {
  activeItem: string;
  strategyStore: any;
  selectedStrategy?: Strategy;
  // ... other props
};

export function CenterPanelRouter({ activeItem, ...props }: CenterPanelRouterProps) {
  switch (activeItem) {
    case 'library':
      return (
        <StrategyLibraryPanel
          strategies={props.strategyStore.strategies}
          selectedId={props.selectedStrategy?.id}
          onSelectStrategy={props.onSelectStrategy}
          onCreateNew={props.onCreateStrategy}
          loading={props.loadingStrategies}
        />
      );

    case 'studio':
      return (
        <StudioPanel
          strategyCode={props.selectedStrategy?.code || ''}
          onCodeChange={props.onCodeChange}
          strategyName={props.selectedStrategy?.name}
          universe={props.universe}
          onUniverseChange={props.onUniverseChange}
          assumptions={props.assumptions}
          onAssumptionsChange={props.onAssumptionsChange}
          onSave={props.onSave}
          isDirty={props.isDirty}
          isSaving={props.isSaving}
        />
      );

    case 'runs':
      return (
        <RunsPanel
          runs={props.backtestStore.runs}
          selectedRunId={props.selectedRunId}
          onSelectRun={props.onSelectRun}
          onRunBacktest={props.onRunBacktest}
          onDownloadArtifacts={props.onDownloadArtifacts}
          isRunning={props.isBacktestRunning}
          error={props.backtestError}
        />
      );

    case 'reports':
      return (
        <ReportsPanel
          report={props.selectedReport}
          loading={props.reportLoading}
          onExportReport={props.onExportReport}
        />
      );

    case 'compare':
      return (
        <ComparePanel
          availableRuns={props.comparisonRuns}
          selectedRunIds={props.selectedComparisonIds}
          onToggleRun={props.onToggleComparisonRun}
          onCompare={props.onPerformComparison}
          comparisonResult={props.comparisonResult}
        />
      );

    case 'data':
      return (
        <DataSourcePanel
          dataSources={props.dataSourceStore.sources}
          onAddDataSource={props.onAddDataSource}
          onSyncDataSource={props.onSyncDataSource}
          onRemoveDataSource={props.onRemoveDataSource}
          onValidateData={props.onValidateData}
          syncProgress={props.syncProgress}
          validationResult={props.validationResult}
        />
      );

    case 'settings':
      return (
        <SettingsPanel
          settings={props.settings}
          onSettingsChange={props.onSettingsChange}
          onReset={props.onResetSettings}
          onExport={props.onExportSettings}
        />
      );

    default:
      return <div>Unknown panel: {activeItem}</div>;
  }
}
```

### Step 6: Update Zustand Store

Extend the strategy research store to include new state:

```typescript
// In strategyResearchStore.ts (or similar)

interface StrategyResearchState {
  // EXISTING STATE
  strategies: Strategy[];
  activeStrategyId?: string;
  backtestRuns: BacktestRun[];

  // NEW STATE FOR EXPANDED UI
  universe: UniverseSettings;
  assumptions: AssumptionSet;
  selectedComparisonRunIds: string[];
  comparisonResult?: ComparisonResult;
  cliLogs: LogEntry[];
  dataValidationResult?: ValidationResult;
  syncProgress?: number;
  settings: Settings;

  // ACTIONS
  setUniverse: (universe: UniverseSettings) => void;
  setAssumptions: (assumptions: AssumptionSet) => void;
  toggleComparisonRun: (runId: string) => void;
  performComparison: () => void;
  addCliLog: (log: LogEntry) => void;
  clearCliLogs: () => void;
  validateData: () => Promise<ValidationResult>;
  syncDataSource: (sourceId: string) => Promise<void>;
  updateSettings: (settings: Settings) => void;
  // ... other actions
}

export const useStrategyResearchStore = create<StrategyResearchState>(
  (set, get) => ({
    // Initial state
    strategies: [],
    universe: { universe: "sp500", dataSource: "stooq" },
    assumptions: {
      /* default assumptions */
    },
    selectedComparisonRunIds: [],
    cliLogs: [],
    settings: {
      /* default settings */
    },

    // Actions
    setUniverse: (universe) => set({ universe }),
    setAssumptions: (assumptions) => set({ assumptions }),
    toggleComparisonRun: (runId) =>
      set((state) => ({
        selectedComparisonRunIds: state.selectedComparisonRunIds.includes(runId)
          ? state.selectedComparisonRunIds.filter((id) => id !== runId)
          : state.selectedComparisonRunIds.length < 3
            ? [...state.selectedComparisonRunIds, runId]
            : state.selectedComparisonRunIds,
      })),
    addCliLog: (log) =>
      set((state) => ({
        cliLogs: [...state.cliLogs, log].slice(-100), // Keep last 100
      })),
    clearCliLogs: () => set({ cliLogs: [] }),
    // ... other action implementations
  }),
);
```

### Step 7: Wire Backend API Calls

In StrategyResearch.tsx, add effect hooks to sync with stores:

```typescript
// Fetch strategy list on mount
useEffect(() => {
  async function loadStrategies() {
    const strategies = await api.get("/api/strategy/list");
    strategyResearchStore.updateStrategies(strategies);
  }
  loadStrategies();
}, []);

// Fetch runs for selected strategy
useEffect(() => {
  if (!selectedStrategyId) return;

  async function loadRuns() {
    const runs = await api.get(`/api/strategy/${selectedStrategyId}/runs`);
    strategyResearchStore.updateRuns(runs);
  }
  loadRuns();
}, [selectedStrategyId]);

// Stream CLI logs from backend
useEffect(() => {
  const eventSource = new EventSource("/api/strategy/backtest/stream-logs");
  eventSource.onmessage = (event) => {
    const log = JSON.parse(event.data);
    strategyResearchStore.addCliLog(log);
  };
  return () => eventSource.close();
}, []);
```

## File Structure After Integration

```
apps/desktop/src/renderer/
├── components/
│   ├── StrategyResearch.tsx (MODIFIED)
│   ├── StrategyResearchLayout.tsx (EXISTING)
│   ├── CenterPanelRouter.tsx (NEW)
│   ├── RightInspectorRouter.tsx (NEW)
│   ├── StrategyLibraryPanel.tsx (NEW)
│   ├── StudioPanel.tsx (NEW)
│   ├── RunsPanel.tsx (NEW)
│   ├── ReportsPanel.tsx (NEW)
│   ├── ComparePanel.tsx (NEW)
│   ├── DataSourcePanel.tsx (NEW)
│   ├── SettingsPanel.tsx (NEW)
│   ├── CLIDrawerPanel.tsx (NEW)
│   └── RunComposerModal.tsx (TODO)
├── stores/
│   └── strategyResearchStore.ts (MODIFIED with new state)
└── api/
    └── strategy-api.ts (NEW or MODIFIED)
```

## Phase 1C: Next Steps

1. **Create CenterPanelRouter + RightInspectorRouter**: Route panel content based on active rail item
2. **Create RunComposerModal**: Gate before backtest execution, confirm all settings
3. **Wire backend APIs**: Connect panels to `/api/strategy/*` endpoints
4. **Add charting**: Integrate chart library for equity curves, monthly returns
5. **Test integration**: Verify state flow, API calls, UI interactions

## Checklist

- [ ] Add panel imports to StrategyResearch.tsx
- [ ] Replace 4-tab state with 7-rail state
- [ ] Create CenterPanelRouter.tsx
- [ ] Create RightInspectorRouter.tsx
- [ ] Update StrategyResearchLayout usage in StrategyResearch.tsx
- [ ] Extend Zustand store with new state
- [ ] Wire backend API calls in useEffect hooks
- [ ] Test panel rendering in each rail item
- [ ] Create RunComposerModal component
- [ ] Wire RunComposerModal to backtest flow
