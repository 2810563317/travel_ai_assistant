import type { UserProfile } from "../types/chatMessage";

// ── 值映射：英文枚举 → 中文 ──

const TRAVEL_STYLE: Record<string, string> = {
  budget: "经济型",
  standard: "标准型",
  comfortable: "舒适型",
  luxury: "豪华型",
};

const HOTEL_LEVEL: Record<string, string> = {
  hostel: "青旅",
  economy: "经济型",
  mid_range: "中档",
  high_end: "高档",
  luxury: "豪华型",
};

const TRANSPORT: Record<string, string> = {
  public_transport: "公共交通",
  taxi: "出租车",
  rental_car: "租车",
  walking: "步行",
  mixed: "多种方式",
};

const DIETARY: Record<string, string> = {
  vegetarian: "素食",
  vegan: "纯素",
  halal: "清真",
  kosher: "犹太洁食",
  gluten_free: "无麸质",
};

const LANGUAGE: Record<string, string> = {
  "zh-CN": "中文",
  "en-US": "英文",
  "ja-JP": "日文",
};

// ── 键值对描述项 ──

function collectDescriptors(profile: UserProfile): string[] {
  const p = profile.preferences;
  const c = profile.constraints;
  const items: string[] = [];

  if (p.travel_style)
    items.push(`旅行风格：${TRAVEL_STYLE[p.travel_style] ?? p.travel_style}`);
  if (p.hotel_level)
    items.push(`酒店等级：${HOTEL_LEVEL[p.hotel_level] ?? p.hotel_level}`);
  if (p.transport_preference)
    items.push(`交通偏好：${TRANSPORT[p.transport_preference] ?? p.transport_preference}`);
  if (p.dietary_restrictions?.length) {
    const cn = p.dietary_restrictions.map((d) => DIETARY[d] ?? d).join("、");
    items.push(`饮食限制：${cn}`);
  }
  if (p.food_allergies?.length)
    items.push(`食物过敏：${p.food_allergies.join("、")}`);
  if (p.preferred_currency)
    items.push(`货币偏好：${p.preferred_currency}`);
  if (p.language)
    items.push(`语言偏好：${LANGUAGE[p.language] ?? p.language}`);
  if (c.avoid_places?.length)
    items.push(`避开地点：${c.avoid_places.join("、")}`);
  if (c.mobility_limitations?.length)
    items.push(`行动限制：${c.mobility_limitations.join("、")}`);
  if (c.max_walking_minutes_per_day)
    items.push(`每日步行上限：${c.max_walking_minutes_per_day} 分钟`);
  if (c.needs_child_friendly_plan)
    items.push("需要亲子友好方案");

  return items;
}

// ── 自然语言片段（稀疏画像 <4 字段时使用）──

function collectProseFragments(profile: UserProfile): string[] {
  const p = profile.preferences;
  const c = profile.constraints;
  const fragments: string[] = [];

  if (p.travel_style)
    fragments.push(`偏好${TRAVEL_STYLE[p.travel_style] ?? p.travel_style}旅行`);
  if (p.hotel_level)
    fragments.push(`住宿偏好${HOTEL_LEVEL[p.hotel_level] ?? p.hotel_level}`);
  if (p.transport_preference)
    fragments.push(`倾向${TRANSPORT[p.transport_preference] ?? p.transport_preference}`);
  if (p.dietary_restrictions?.length) {
    const cn = p.dietary_restrictions.map((d) => DIETARY[d] ?? d).join("、");
    fragments.push(`不吃${cn}`);
  }
  if (p.food_allergies?.length)
    fragments.push(`对${p.food_allergies.join("、")}过敏`);
  if (p.preferred_currency)
    fragments.push(`使用${p.preferred_currency}计价`);
  if (p.language)
    fragments.push(`使用${LANGUAGE[p.language] ?? p.language}`);
  if (c.avoid_places?.length)
    fragments.push(`避开${c.avoid_places.join("、")}`);
  if (c.mobility_limitations?.length)
    fragments.push(`行动需注意${c.mobility_limitations.join("、")}`);
  if (c.max_walking_minutes_per_day)
    fragments.push(`每天步行不超过${c.max_walking_minutes_per_day}分钟`);
  if (c.needs_child_friendly_plan)
    fragments.push("需要亲子友好方案");

  return fragments;
}

/**
 * 将结构化的 UserProfile 转为模型可读的文本。
 *
 * - 空画像（0 字段）→ 返回 "[User Profile]"，由调用方判断后显示友好提示
 * - 稀疏画像（1~3 字段）→ 自然语言 prose，信息密度高
 * - 密集画像（≥4 字段）→ 键值对列表，结构清晰
 */
export function formatUserProfile(profile: UserProfile): string {
  const descriptors = collectDescriptors(profile);
  if (descriptors.length === 0) return "[User Profile]";

  if (descriptors.length < 4) {
    const fragments = collectProseFragments(profile);
    return `[User Profile]\n${fragments.join("，")}。`;
  }

  return `[User Profile]\n${descriptors.map((d) => `- ${d}`).join("\n")}`;
}
