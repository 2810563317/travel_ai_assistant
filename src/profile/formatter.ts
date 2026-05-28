import type { UserProfile } from "../types/chatMessage";

/** 将结构化的 UserProfile 转为 system 消息文本。 */
export function formatUserProfile(profile: UserProfile): string {
  const p = profile.preferences;
  const c = profile.constraints;
  const lines: string[] = ["[User Profile]"];

  if (p.travel_style) lines.push(`Travel style: ${p.travel_style}`);
  if (p.hotel_level) lines.push(`Hotel level: ${p.hotel_level}`);
  if (p.transport_preference) lines.push(`Transport: ${p.transport_preference}`);
  if (p.dietary_restrictions?.length)
    lines.push(`Dietary: ${p.dietary_restrictions.join(", ")}`);
  if (p.food_allergies?.length) lines.push(`Allergies: ${p.food_allergies.join(", ")}`);
  if (p.preferred_currency) lines.push(`Currency: ${p.preferred_currency}`);
  if (p.language) lines.push(`Language: ${p.language}`);

  if (c.avoid_places?.length) lines.push(`Avoid: ${c.avoid_places.join(", ")}`);
  if (c.mobility_limitations?.length)
    lines.push(`Mobility: ${c.mobility_limitations.join(", ")}`);
  if (c.max_walking_minutes_per_day)
    lines.push(`Max walking: ${c.max_walking_minutes_per_day} min/day`);
  if (c.needs_child_friendly_plan) lines.push("Child-friendly: yes");

  return lines.join("\n");
}
