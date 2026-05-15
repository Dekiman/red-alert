import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";

const rootNode = document.getElementById("root");
if (!rootNode) {
  throw new Error("missing root element");
}

createRoot(rootNode).render(<App />);
