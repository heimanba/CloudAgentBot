import "./ui/design-system/theme.css";
import "./app.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import { TooltipProvider } from "./ui/design-system";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={500}>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
