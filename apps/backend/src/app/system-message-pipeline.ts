import { createSystemMessageNormalizer } from "../system-messages/parser.js";

export function createSystemMessagePipeline(options) {
  const { getLocalityMapIdsForLocations, uiBroadcaster } = options;
  const normalizeSystemMessageForUi = createSystemMessageNormalizer(getLocalityMapIdsForLocations);

  function publishSystemMessage(rawPayload, source) {
    const normalized = normalizeSystemMessageForUi(rawPayload, source);
    uiBroadcaster.broadcast({
      type: "system_message",
      systemMessage: normalized
    });
    return normalized;
  }

  return {
    publishSystemMessage
  };
}
