export type Role = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, any>;
  };
};

export type BaseMessage = {
  id: string;
  role: Role;
  created_at: string;
};

export type SystemMessage = BaseMessage & {
  role: "system";
  content: string;
};

export type UserMessage = BaseMessage & {
  role: "user";
  content: string;
};

export type AssistantMessage = BaseMessage & {
  role: "assistant";
  content?: string;
  tool_calls?: ToolCall[];
};

export type ToolMessage = BaseMessage & {
  role: "tool";
  tool_call_id: string;
  name: string;
  content: string;
};

export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export type TravelStyle = "budget" | "standard" | "comfortable" | "luxury";
export type TransportPreference = "public_transport" | "taxi" | "rental_car" | "walking" | "mixed";
export type DietaryRestriction = "vegetarian" | "vegan" | "halal" | "kosher" | "gluten_free";

export type UserProfile = {
  user_id: string;

  preferences: {
    travel_style?: TravelStyle;
    hotel_level?: "hostel" | "economy" | "mid_range" | "high_end" | "luxury";
    transport_preference?: TransportPreference;
    dietary_restrictions?: DietaryRestriction[];
    food_allergies?: string[];
    preferred_currency?: "CNY" | "USD" | "JPY" | "EUR" | "GBP" | "KRW" | "HKD" | "SGD";
    language?: "zh-CN" | "en-US" | "ja-JP";
  };

  constraints: {
    avoid_places?: string[];
    mobility_limitations?: string[];
    max_walking_minutes_per_day?: number;
    needs_child_friendly_plan?: boolean;
  };

  updated_at: string;
};
