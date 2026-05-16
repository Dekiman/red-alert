declare global {
  interface Window {
    RED_ALERT_UI_CONFIG?: {
      uiSocketPath?: string;
    };
  }
}

const DEFAULT_UI_SOCKET_PATH = "/ui-socket";

export function getUiSocketPath() {
  const value = window.RED_ALERT_UI_CONFIG?.uiSocketPath;
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (
      trimmedValue.length > 0 &&
      !trimmedValue.includes("__UI_SOCKET_PATH__")
    ) {
      if (trimmedValue.startsWith("ws://") || trimmedValue.startsWith("wss://")) {
        return trimmedValue;
      }
      return trimmedValue.startsWith("/") ? trimmedValue : `/${trimmedValue}`;
    }
  }
  return DEFAULT_UI_SOCKET_PATH;
}
