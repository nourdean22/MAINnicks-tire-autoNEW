// FIXTURE - intentionally violates no-native-dialogs-ts (the .ts-language
// twin of the .tsx rule; both must keep firing). Never imported.
export function badDialogsPlain(): string | null {
  if (globalThis.confirm("proceed?")) {
    return window.prompt("value?");
  }
  return null;
}
