import express from "express";
import { requireUser } from "./middleware/auth";
import { cartRouter } from "./routes/cart";
import { productsRouter } from "./routes/products";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/products", productsRouter);
  app.use("/api/cart", requireUser, cartRouter);
  app.get("/health", healthCheck);
  return app;
}

function healthCheck(_request: express.Request, response: express.Response) {
  response.json({ ok: true });
}
