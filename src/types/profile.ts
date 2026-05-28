import type { UserProfile } from "./chatMessage";

export type ProfilePatch = {
  preferences?: Partial<UserProfile["preferences"]>;
  constraints?: Partial<UserProfile["constraints"]>;
};
