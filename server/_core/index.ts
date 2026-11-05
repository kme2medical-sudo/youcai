import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { publicPlatformScript } from "./publicConfig";
import { serveStatic, setupVite } from "./vite";
import { crmRouter } from "../crm/api";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => res.type("application/javascript").send(publicPlatformScript()));
  app.use("/api", crmRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint not found" }));
  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);
  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Youcai CRM listening on port ${port}`));
}
startServer().catch(() => { console.error("CRM startup failed; inspect deployment configuration."); process.exit(1); });
