/**
 * Refuse a shell-mangled site path before it reaches a live third-party API.
 *
 * WHY THIS IS A MODULE AND NOT A COMMENT. On 2026-09-09 a bare `/careers`
 * argument reached IndexNow's live API as
 * `https://nickstire.org/C:/Program Files/Git/careers`: Git Bash on Windows
 * (MSYS) rewrites a leading-slash argument into an absolute Windows path
 * BEFORE Node's process.argv is populated. Both submitter scripts documented
 * that trap in their headers. A header is not a gate — the second script still
 * had no check, and its endpoint is Google's Indexing API, which enforces a
 * hard daily quota that junk submissions burn.
 *
 * A legitimate site path never contains a drive letter, a backslash or a
 * colon, so anything carrying one was rewritten by the shell. These
 * submissions cannot be recalled once sent, so the correct response is to
 * refuse the whole run rather than to guess at the intent.
 */

/** True when an argv value was rewritten by the shell rather than typed as a path. */
export const looksShellMangled = (arg) => /^[A-Za-z]:|\\|:/.test(arg);

/**
 * Exit non-zero with an actionable message if any argument looks mangled.
 * Call BEFORE building any URL or opening any connection.
 */
export function refuseMangledPaths(args, { scriptName }) {
  const mangled = args.filter(looksShellMangled);
  if (!mangled.length) return;

  console.error("REFUSING TO SUBMIT — argument looks shell-mangled, not a site path:");
  for (const p of mangled) console.error(`  ${p}`);
  console.error("\nGit Bash on Windows rewrites a bare /path into an absolute Windows path");
  console.error("before Node sees it. Drop the leading slash:");
  console.error(`  node scripts/${scriptName} careers`);
  console.error("or prefix MSYS_NO_PATHCONV=1, or double the slash (//careers).");
  process.exit(1);
}
