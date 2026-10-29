/** Task notes + photo limits, shared by the client and the service (no server imports here). */

/** Same number as the CHECK constraint task_attachments_byte_size_check. */
export const TASK_PHOTO_MAX_BYTES = 512 * 1024;
export const TASK_NOTES_MAX_CHARS = 20_000;
