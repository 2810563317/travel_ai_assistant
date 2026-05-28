import type { UserProfile } from "../types/chatMessage";
import type { ProfilePatch } from "../types/profile";

// All array-typed fields across preferences and constraints that should be
// merged (union) rather than overwritten on update.
const MERGE_ARRAY_KEYS: (keyof UserProfile["preferences"] | keyof UserProfile["constraints"])[] = [
  "dietary_restrictions",
  "food_allergies",
  "avoid_places",
  "mobility_limitations",
];

function mergeArrays<T>(current: T[] = [], incoming: T[] = []): T[] {
  return [...new Set([...current, ...incoming])];
}

function isMergeArrayKey(
  key: string
): key is keyof UserProfile["preferences"] | keyof UserProfile["constraints"] {
  return (MERGE_ARRAY_KEYS as string[]).includes(key);
}

/** Apply a partial patch to the full UserProfile. Array fields are merged (union);
 *  scalar fields are overwritten. */
export function mergeProfile(current: UserProfile, patch: ProfilePatch): UserProfile {
  let result = current;

  if (patch.preferences) {
    const mergedPrefs = { ...result.preferences };
    for (const [key, value] of Object.entries(patch.preferences)) {
      if (isMergeArrayKey(key)) {
        (mergedPrefs as any)[key] = mergeArrays(
          (result.preferences as any)[key],
          value as any[]
        );
      } else {
        (mergedPrefs as any)[key] = value;
      }
    }
    result = { ...result, preferences: mergedPrefs };
  }

  if (patch.constraints) {
    const mergedConstr = { ...result.constraints };
    for (const [key, value] of Object.entries(patch.constraints)) {
      if (isMergeArrayKey(key)) {
        (mergedConstr as any)[key] = mergeArrays(
          (result.constraints as any)[key],
          value as any[]
        );
      } else {
        (mergedConstr as any)[key] = value;
      }
    }
    result = { ...result, constraints: mergedConstr };
  }

  return result;
}
