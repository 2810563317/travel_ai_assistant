export type ToolOutputConfig = {
  /** 最多保留的顶层结果数 */
  maxResults: number;
  /** 每条结果保留的字段（白名单，不在列表中的字段全部丢弃） */
  keepFields: string[];
  /** 该工具输出的 token 预算上限 */
  maxTokens: number;
};

export const TOOL_OUTPUT_CONFIGS: Record<string, ToolOutputConfig> = {
  search_hotels: {
    maxResults: 8,
    keepFields: ["hotel_id", "name", "price_per_night", "rating", "distance_km"],
    maxTokens: 2_000,
  },
  search_flights: {
    maxResults: 10,
    keepFields: ["flight_number", "airline", "departure_time", "arrival_time", "price"],
    maxTokens: 2_000,
  },
  search_attractions: {
    maxResults: 10,
    keepFields: ["attraction_id", "name", "rating", "opening_hours", "ticket_price"],
    maxTokens: 2_000,
  },
  get_weather: {
    maxResults: 7,
    keepFields: ["date", "temp_high", "temp_low", "condition", "precipitation"],
    maxTokens: 1_500,
  },
  calculate_budget: {
    maxResults: 1,
    keepFields: [], // keep all fields — already compact
    maxTokens: 2_000,
  },
};

export const DEFAULT_TOOL_CONFIG: ToolOutputConfig = {
  maxResults: 10,
  keepFields: [],
  maxTokens: 2_000,
};

/** 单条消息的绝对上限，字段过滤后仍不得超过此值。 */
export const SINGLE_MESSAGE_HARD_CAP = 4_000;
