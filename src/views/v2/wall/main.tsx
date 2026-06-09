// /wall — React island entry point for the NOC big-board.
//
// Mounts <Wall /> to #wall-root with the shared TanStack QueryClient + SSE
// provider. Re-uses everything from ../data/ and ../panels/ — this entry
// only owns the wall layout, alert-zoom behavior, and ticker.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { IconSprite } from "../icon-sprite.tsx";
import { queryClient } from "../data/queryClient.ts";
import { SseProvider } from "../data/sse.ts";
import { Wall } from "./Wall.tsx";
import "../tokens.css";
import "./wall.css";

const container = document.getElementById("wall-root");
if (!container) {
  throw new Error("[wall] #wall-root not found in document");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SseProvider>
        <IconSprite />
        <Wall />
      </SseProvider>
    </QueryClientProvider>
  </StrictMode>,
);
