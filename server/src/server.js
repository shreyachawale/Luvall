import { createApp } from "./app.js";
import { assertProductionConfig, config } from "./config.js";
import { connect, ensureIndexes } from "./db.js";
import "./models/index.js";
import { log } from "./utils/logger.js";

assertProductionConfig();
await connect();
await ensureIndexes();

const server = createApp().listen(config.port, () => {
  log("info", `LuvAll Sports API listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
