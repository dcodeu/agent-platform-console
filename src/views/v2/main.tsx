// V2 React island entry point.
//
// Routing: hash-based via useTabRouter — `#spend`, `#agents`, etc. The active
// TabComponent is looked up in TAB_COMPONENTS and rendered inside AppShell.
//
// Mount order from outside in:
//   QueryClientProvider → SseProvider → IconSprite + Ticker + CommandPalette +
//   ApprovalBanner above AppShell content.
//
// Ticker is fixed-positioned and lives OUTSIDE AppShell so it floats
// independently. CommandPalette is a portal-style overlay (rendered at root).

import { StrictMode } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { AppShell } from "./AppShell.tsx";
import { IconSprite } from "./icon-sprite.tsx";
import { queryClient } from "./data/queryClient.ts";
import { RangeProvider } from "./data/RangeContext.tsx";
import { SseProvider } from "./data/sse.ts";
import { useTabRouter } from "./tabs/use-tab-router.ts";
import type { TabKey } from "./tabs/tab-registry.ts";
import { OverviewTab } from "./tabs/OverviewTab.tsx";
import { SpendTab } from "./tabs/SpendTab.tsx";
import { AgentsTab } from "./tabs/AgentsTab.tsx";
import { IMessageTab } from "./tabs/IMessageTab.tsx";
import { ServerTab } from "./tabs/ServerTab.tsx";
import { APMTab } from "./tabs/APMTab.tsx";
import { LogsTab } from "./tabs/LogsTab.tsx";
import { ApprovalsTab } from "./tabs/ApprovalsTab.tsx";
import ApprovalBanner from "./components/ApprovalBanner.tsx";
import Ticker from "./components/Ticker.tsx";
import CommandPalette from "./components/CommandPalette.tsx";
import { PulseStrip } from "./widgets/PulseStrip.tsx";
import "./tokens.css";
import "./main.css";

const container = document.getElementById("v2-root");
if (!container) {
  throw new Error("[v2] #v2-root not found in document");
}

const TAB_COMPONENTS: Record<TabKey, () => JSX.Element> = {
  overview: OverviewTab,
  apm: APMTab,
  logs: LogsTab,
  spend: SpendTab,
  agents: AgentsTab,
  imessage: IMessageTab,
  server: ServerTab,
  approvals: ApprovalsTab,
};

function App() {
  const { tab, setTab } = useTabRouter();
  const TabComponent = TAB_COMPONENTS[tab];
  return (
    <div style={{ position: "relative" }}>
      <AppShell tab={tab} onTabChange={setTab}>
        <PulseStrip />
        <ApprovalBanner />
        <TabComponent />
      </AppShell>
      <Ticker />
      <CommandPalette />
    </div>
  );
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RangeProvider>
        <SseProvider>
          <IconSprite />
          <App />
        </SseProvider>
      </RangeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
