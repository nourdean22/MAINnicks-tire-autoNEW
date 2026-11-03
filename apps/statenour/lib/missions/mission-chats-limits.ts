/**
 * The missions page's linked-chats limits and result shape, with no server imports: the client card and the server
 * read (mission-chats.ts) share them. CONTROLS RULE: each cap is named once, here.
 */
export const MISSION_CHATS_PER_MISSION = 3;
export const MISSION_CHATS_READ_CAP = 300;
/** Missions per read (the procedure's input cap); a mission past it shows "not read". */
export const MISSION_CHATS_IDS_MAX = 100;

export interface MissionChat {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface MissionChatsResult {
  byMission: Record<string, MissionChat[]>;
  /** The read filled MISSION_CHATS_READ_CAP: a mission showing fewer than its cap may have older chats unread. */
  truncated: boolean;
}
