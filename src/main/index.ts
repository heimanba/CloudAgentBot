import { app } from "electron";
import { bootstrap } from "./bootstrap";

bootstrap().catch((err) => {
  console.error("failed to bootstrap main", err);
  process.exitCode = 1;
  app.quit();
});
