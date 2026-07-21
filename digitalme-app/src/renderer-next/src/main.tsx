import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./AppShell";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing #root");
}

createRoot(rootEl).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
);
