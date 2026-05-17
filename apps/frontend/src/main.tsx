import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StateProvider } from "@json-render/react";
import { routeTree } from './routeTree.gen'
import { jsonRenderStore } from "./stores/useDashboardStore";
import "./index.css";

const queryClient = new QueryClient()

const router = createRouter({ 
  routeTree,
  context: {
    queryClient,
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootNode = document.getElementById("root");
if (!rootNode) {
  throw new Error("missing root element");
}

createRoot(rootNode).render(
  <QueryClientProvider client={queryClient}>
    <StateProvider store={jsonRenderStore}>
      <RouterProvider router={router} />
    </StateProvider>
  </QueryClientProvider>
);
