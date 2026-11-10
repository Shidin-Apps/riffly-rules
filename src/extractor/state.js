let rules = null;
export function setRules(r) { rules = r; }
export function getRules() {
  if (!rules) throw new Error('Tonik.configure(rules) was not called');
  return rules;
}
