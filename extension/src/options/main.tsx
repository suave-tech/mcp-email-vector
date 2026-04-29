import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Options } from "./Options";

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
