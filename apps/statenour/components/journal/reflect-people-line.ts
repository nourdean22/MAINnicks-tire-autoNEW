/**
 * The composer toast's people line (W8b): who the save-time link reached. Null or missing is a link that failed,
 * which must not read the same as a line that named no one.
 */
export function reflectPeopleLine(linked: { names: string[] } | null | undefined): string {
  if (!linked) return " · People: couldn't link";
  return linked.names.length ? ` · People: ${linked.names.join(", ")}` : "";
}
