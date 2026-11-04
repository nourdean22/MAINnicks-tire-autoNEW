/**
 * The missions page's linked-chats limits and result shape, with no server imports: the client card and the server
 * read (mission-chats.ts) share them. CONTROLS RULE: each cap is named once, here.
 */
export const MISSION_CHATS_PER_MISSION = 3;
export const MISSION_CHATS_READ_CAP = 300;
/** Missions per read (the procedure's input cap); a mission past it shows "not read". */
export const MISSION_CHATS_IDS_MAX = 100;
/** Open link-review rows read per board (the linker queues one per chat at most, so 392 chats fit). */
export const MISSION_REVIEW_READ_CAP = 500;

/**
 * W8c · chats the nightly conversation-mission-link cron embeds per run when they have no vector yet
 * (lib/db/conversation-mission-linker.ts). Sized for the job's 60 s budget: one embed call plus one small
 * message read each, about 0.5 s together (INFERRED, not measured), so 40 is about 20 s; the 353-chat
 * backlog clears in about nine nights. Lives here so the page can say the same number.
 */
export const LINKER_EMBED_PER_RUN = 40;

export interface MissionChat {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface MissionChatsResult {
  byMission: Record<string, MissionChat[]>;
  /** The read filled MISSION_CHATS_READ_CAP: a mission showing fewer than its cap may have older chats unread. */
  truncated: boolean;
  /** Open link-review rows per mission (the linker's medium matches waiting for a yes or no). */
  reviewByMission: Record<string, number>;
}
