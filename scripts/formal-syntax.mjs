/** Mask TLA+ comments and quoted strings while preserving token separation and line boundaries. */
export function formalCodeText(source) {
  if (typeof source !== "string") throw new Error("Formal source must be text.");
  const result = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("\\*", index)) {
      while (index < source.length && source[index] !== "\n") { result.push(" "); index += 1; }
    } else if (source.startsWith("(*", index)) {
      let depth = 1; result.push("  "); index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("(*", index)) { depth += 1; result.push("  "); index += 2; }
        else if (source.startsWith("*)", index)) { depth -= 1; result.push("  "); index += 2; }
        else { result.push(source[index] === "\n" ? "\n" : " "); index += 1; }
      }
      if (depth !== 0) throw new Error("Unterminated formal block comment.");
    } else if (source[index] === '"') {
      result.push(" "); index += 1;
      let closed = false;
      while (index < source.length) {
        const character = source[index]; result.push(character === "\n" ? "\n" : " "); index += 1;
        if (character === '"') { closed = true; break; }
        if (character === "\\" && index < source.length) { result.push(" "); index += 1; }
      }
      if (!closed) throw new Error("Unterminated formal string.");
    } else { result.push(source[index]); index += 1; }
  }
  return result.join("");
}
