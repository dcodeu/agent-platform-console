import assert from "node:assert/strict";
import test from "node:test";

import {
  friendlyContainerName,
  friendlyContainerState,
  containerPillState,
} from "./server-container-display.ts";

test("friendlyContainerName maps platform containers to operator-facing names", () => {
  assert.equal(friendlyContainerName({ name: "docker-paperclip-1", image: "docker-paperclip" }), "Paperclip");
  assert.equal(friendlyContainerName({ name: "postgres", image: "pgvector/pgvector:pg16" }), "Postgres");
  assert.equal(friendlyContainerName({ name: "n8n", image: "n8nio/n8n:latest" }), "n8n");
  assert.equal(friendlyContainerName({ name: "kuma-host-bridge", image: "alpine/socat:latest" }), "Kuma host bridge");
});

test("friendlyContainerName falls back to a cleaned compose/container name", () => {
  assert.equal(friendlyContainerName({ name: "docker-some-worker-1", image: "example/worker:latest" }), "Some worker");
  assert.equal(friendlyContainerName({ name: "custom_service", image: "example/service:latest" }), "Custom service");
});

test("friendlyContainerState returns friendly state labels from Docker status text", () => {
  assert.equal(friendlyContainerState("Up 2 hours (healthy)"), "Healthy");
  assert.equal(friendlyContainerState("Up 2 hours (unhealthy)"), "Down");
  assert.equal(friendlyContainerState("Restarting (1) 8 seconds ago"), "Restarting");
  assert.equal(friendlyContainerState("Exited (0) 4 minutes ago"), "Down");
  assert.equal(friendlyContainerState("Paused"), "Paused");
  assert.equal(friendlyContainerState("Created"), "Down");
});

test("containerPillState matches friendly state severity", () => {
  assert.equal(containerPillState("Up 2 hours (healthy)"), "ok");
  assert.equal(containerPillState("Up 2 hours"), "ok");
  assert.equal(containerPillState("Restarting (1) 8 seconds ago"), "warn");
  assert.equal(containerPillState("Paused"), "warn");
  assert.equal(containerPillState("Exited (1) 4 minutes ago"), "alert");
});
