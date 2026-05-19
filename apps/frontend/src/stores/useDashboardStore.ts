import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { zustandStateStore } from "@json-render/zustand";
import type { AlertPayload, NewsEventPayload } from "../app/contracts.js";

interface DashboardState {
  alerts: AlertPayload[];
  newsEvents: NewsEventPayload[];
  connectionState: "live" | "down" | "connecting";
  connectionText: string;
  uiClients: number;
  bufferedAlerts: number;
  bufferedNewsEvents: number;
  updatedAt: string;
  selectedCountry: string | null;
  [key: string]: any;
  setAlerts: (alerts: AlertPayload[]) => void;
  addAlert: (alert: AlertPayload) => void;
  setNewsEvents: (events: NewsEventPayload[]) => void;
  addNewsEvent: (event: NewsEventPayload) => void;
  setConnectionState: (state: "live" | "down" | "connecting", text?: string) => void;
  setStats: (stats: { uiClients: number; bufferedAlerts: number; bufferedNewsEvents: number }) => void;
  setUpdatedAt: (time: string) => void;
  setSelectedCountry: (country: string | null) => void;
}

export const dashboardStore = createStore<DashboardState>((set) => ({
  alerts: [],
  newsEvents: [],
  connectionState: "connecting",
  connectionText: "Connecting...",
  uiClients: 0,
  bufferedAlerts: 0,
  bufferedNewsEvents: 0,
  updatedAt: "-",
  selectedCountry: null,
  setAlerts: (alerts) => set((state) => {
    if (state.alerts === alerts) return state;
    return { alerts };
  }),
  addAlert: (alert) => set((state) => {
    const existing = state.alerts.find((a) => a.notificationId === alert.notificationId);
    if (existing) return state;
    return { alerts: [alert, ...state.alerts].slice(0, 150) };
  }),
  setNewsEvents: (newsEvents) => set((state) => {
    if (state.newsEvents === newsEvents) return state;
    return { newsEvents };
  }),
  addNewsEvent: (event) => set((state) => {
    const existing = state.newsEvents.find((e) => e.eventId === event.eventId);
    if (existing) return state;
    return { newsEvents: [event, ...state.newsEvents].slice(0, 150) };
  }),
  setConnectionState: (connectionState, connectionText) => set((state) => {
    const text = connectionText ?? (connectionState === "live" ? "Connected" : connectionState === "down" ? "Disconnected" : "Connecting...");
    if (state.connectionState === connectionState && state.connectionText === text) return state;
    return { connectionState, connectionText: text };
  }),
  setStats: (stats) => set((state) => {
    if (
      state.uiClients === stats.uiClients &&
      state.bufferedAlerts === stats.bufferedAlerts &&
      state.bufferedNewsEvents === stats.bufferedNewsEvents
    ) {
      return state;
    }
    return { ...stats };
  }),
  setUpdatedAt: (updatedAt) => set((state) => {
    if (state.updatedAt === updatedAt) return state;
    return { updatedAt };
  }),
  setSelectedCountry: (selectedCountry) => set((state) => {
    if (state.selectedCountry === selectedCountry) return state;
    return { selectedCountry };
  }),
}));

export const useDashboardStore = <T>(selector: (state: DashboardState) => T) => 
  useStore(dashboardStore, selector);

export const jsonRenderStore = zustandStateStore({ store: dashboardStore });
