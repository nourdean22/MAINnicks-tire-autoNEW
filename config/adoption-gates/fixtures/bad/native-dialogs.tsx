// FIXTURE - intentionally violates no-native-dialogs-tsx. Never imported by
// anything; exists so the canary step in adoption-gates.yml can prove the
// ast-grep gate still SEES violations before trusting its green on real code.
export function BadDialogs() {
  if (window.confirm("delete this?")) {
    window.alert("gone");
  }
  const name = window.prompt("name?");
  return <span>{name}</span>;
}
