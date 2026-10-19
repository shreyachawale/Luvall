import fs from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server-core";

// A throw-away single-node replica set (transactions need one). Set MONGOMS_SYSTEM_BINARY to use an installed
// mongod (works offline); otherwise mongodb-memory-server downloads a MongoDB binary on first use.
const SANDBOX_MONGOD = "/opt/mongodb-conda/bin/mongod";
let replSet;

export async function setup() {
  if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync(SANDBOX_MONGOD)) process.env.MONGOMS_SYSTEM_BINARY = SANDBOX_MONGOD;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await replSet.waitUntilRunning();
  process.env.TEST_MONGODB_URI = replSet.getUri("luvall_test");
}

export async function teardown() {
  await replSet?.stop();
}
