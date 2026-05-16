import { categorizeNewsEventType } from "../news/event-type.js";

export function createNewsPipeline({ uiRuntime, uiBroadcaster }) {
  function handleLiveNewsEvent(newsEvent) {
    const enrichedNewsEvent = {
      ...newsEvent,
      eventType: categorizeNewsEventType(newsEvent)
    };

    uiRuntime.pushRecentNewsEvent(enrichedNewsEvent);
    uiBroadcaster.broadcast({
      type: "news_event",
      newsEvent: enrichedNewsEvent
    });
    uiBroadcaster.broadcast(uiRuntime.getStatsPayload());
  }

  return {
    handleLiveNewsEvent
  };
}
