import mongoose from "mongoose";

import { config } from "./config.js";

// Every query inside connection.transaction() automatically joins the transaction (no session threading).
mongoose.set("transactionAsyncLocalStorage", true);
mongoose.set("strictQuery", true);

export async function connect(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  return mongoose.connection;
}

export async function disconnect() {
  await mongoose.disconnect();
}

/**
 * Run fn inside a MongoDB multi-document transaction. All Mongoose operations awaited inside fn
 * (directly or in called services) use the transaction. Retries on transient errors, so fn must not
 * have side effects outside the database (files, HTTP) that cannot be repeated.
 */
export async function withTransaction(fn) {
  let result;
  await mongoose.connection.transaction(async () => {
    result = await fn();
  });
  return result;
}

export async function ensureIndexes() {
  const models = Object.values(mongoose.models);
  for (const model of models) {
    await model.createCollection().catch(() => undefined);
    await model.syncIndexes();
  }
}
