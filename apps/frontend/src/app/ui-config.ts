import { env } from "../env";

const DEFAULT_UI_SOCKET_PATH = "/ui-socket";

export function getUiSocketPath() {
  const value = env.VITE_UI_SOCKET_PATH;
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
