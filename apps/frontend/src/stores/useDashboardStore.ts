import { create } from "zustand";
import type { Alert, NewsEvent } from "@red-alert/shared";

interface DashboardState {
  alerts: Alert[];
  newsEvents: NewsEvent[];
  connectionState: "live" | "down" | "connecting";
  uiClients: number;
  bufferedAlerts: number;
  bufferedNewsEvents: number;
  updatedAt: string;
  setAlerts: (alerts: Alert[]) => void;
  addAlert: (alert: Alert) => void;
  setNewsEvents: (events: NewsEvent[]) => void;
  addNewsEvent: (event: NewsEvent) => void;
  setConnectionState: (state: "live" | "down" | "connecting") => void;
  setStats: (stats: { uiClients: number; bufferedAlerts: number; bufferedNewsEvents: number }) => void;
  setUpdatedAt: (time: string) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  alerts: [],
  newsEvents: [],
  connectionState: "connecting",
  uiClients: 0,
  bufferedAlerts: 0,
  bufferedNewsEvents: 0,
  updatedAt: "Never",
  setAlerts: (alerts) => set({ alerts }),
  addAlert: (alert) => set((state) => ({ alerts: [alert, ...state.alerts].slice(0, 150) })),
  setNewsEvents: (newsEvents) => set({ newsEvents }),
  addNewsEvent: (event) => set((state) => ({ newsEvents: [event, ...state.newsEvents].slice(0, 1000) })),
  setConnectionState: (connectionState) => set({ connectionState }),
  setStats: (stats) => set({ ...stats }),
  setUpdatedAt: (updatedAt) => set({ updatedAt }),
}));
