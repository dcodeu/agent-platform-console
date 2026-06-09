import assert from "node:assert/strict";
import test from "node:test";

const tokenEnvPath = "/opt/agent-platform/secrets/integrations/hostinger-vps/token.env";

test("hostingerToken reads only HOSTINGER_API_TOKEN from process env", async () => {
  const oldToken = process.env.HOSTINGER_API_TOKEN;
  try {
    delete process.env.HOSTINGER_API_TOKEN;
    const withoutEnv = await import(`./config.ts?case=without-env-${Date.now()}`);
    assert.equal(withoutEnv.hostingerToken(), null);

    process.env.HOSTINGER_API_TOKEN = "  doppler-token  ";
    const withEnv = await import(`./config.ts?case=with-env-${Date.now()}`);
    assert.equal(withEnv.hostingerToken(), "doppler-token");
  } finally {
    if (oldToken === undefined) {
      delete process.env.HOSTINGER_API_TOKEN;
    } else {
      process.env.HOSTINGER_API_TOKEN = oldToken;
    }
  }
});

test("Hostinger config has no local token.env file-reader dependency", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");

  assert.equal(source.includes(tokenEnvPath), false, "config must not reference Hostinger token.env");
  assert.equal(source.includes("readFileSync"), false, "config must not read local secret files");
  assert.equal(source.includes("existsSync"), false, "config must not probe local secret files");
});

test("AI_INVOCATIONS_DB_URL is derived from split Doppler keys when URL is absent", async () => {
  const oldEnv = {
    AI_INVOCATIONS_DB_URL: process.env.AI_INVOCATIONS_DB_URL,
    AI_INVOCATIONS_DB_HOST: process.env.AI_INVOCATIONS_DB_HOST,
    AI_INVOCATIONS_DB_PORT: process.env.AI_INVOCATIONS_DB_PORT,
    AI_INVOCATIONS_DB_NAME: process.env.AI_INVOCATIONS_DB_NAME,
    AI_INVOCATIONS_DB_USER: process.env.AI_INVOCATIONS_DB_USER,
    AI_INVOCATIONS_DB_PASSWORD: process.env.AI_INVOCATIONS_DB_PASSWORD,
  };
  try {
    delete process.env.AI_INVOCATIONS_DB_URL;
    process.env.AI_INVOCATIONS_DB_HOST = "127.0.0.1";
    process.env.AI_INVOCATIONS_DB_PORT = "5432";
    process.env.AI_INVOCATIONS_DB_NAME = "ai_invocations_db";
    process.env.AI_INVOCATIONS_DB_USER = "grafana_reader";
    process.env.AI_INVOCATIONS_DB_PASSWORD = "p@ss word/with:symbols";

    const cfg = await import(`./config.ts?case=ai-invocations-split-${Date.now()}`);

    assert.equal(
      cfg.AI_INVOCATIONS_DB_URL,
      "postgres://grafana_reader:p%40ss%20word%2Fwith%3Asymbols@127.0.0.1:5432/ai_invocations_db",
    );
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("AI_INVOCATIONS config has no local ai-invocations.env file-reader dependency", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");

  assert.equal(source.includes("/opt/agent-platform/secrets/ai-invocations.env"), false);
  assert.equal(source.includes("ai-invocations.env"), false);
  assert.equal(source.includes("readFileSync"), false, "config must not read local secret files");
  assert.equal(source.includes("existsSync"), false, "config must not probe local secret files");
});
