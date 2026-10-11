/**
 * features/chat-v2/lib/submit-enter.ts · the one rule for "does this Enter
 * send?" (2026-10-10, audit 09-F9 / 09-F10).
 *
 * · IME composing never sends: the Enter that confirms a candidate is not a
 *   send. Safari reports it only as keyCode 229.
 * · On a coarse pointer (phone, tablet) Enter is a newline and the Send
 *   button sends; Cmd/Ctrl+Enter still sends for a hardware keyboard.
 * · Single-line inputs have no newline to protect: call without options.
 */
type EnterEvent = {
  key: string;
  shiftKey: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
};

export function isSubmitEnter(event: EnterEvent, { coarsePointer = false } = {}): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.nativeEvent?.isComposing || event.keyCode === 229) return false;
  return coarsePointer ? Boolean(event.metaKey || event.ctrlKey) : true;
}
