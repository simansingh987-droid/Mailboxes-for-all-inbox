// Parses selections like "1A-5A, 3B 7b", "1-6" (batch A), "10A–12A", "ia" or an email/name.
const norm = (n) => n.replace(/[il]/g, '1').replace(/o/g, '0');

function parseSlot(token) {
  const m = token.match(/^([0-9ilo]+)([a-hj-km-np-z])?$/i);
  if (!m) return null;
  return { num: Number(norm(m[1].toLowerCase())), letter: m[2]?.toUpperCase() };
}

export function parseSlotSelection(text, accounts) {
  const bySlot = new Map(accounts.map((a) => [a.slot, a]));
  const slots = [];
  const unknown = [];
  const add = (s) => { if (bySlot.has(s) && !slots.includes(s)) slots.push(s); };

  const tokens = String(text)
    .replace(/\s*(?:-|–|—|to)\s*/gi, '-')
    .split(/[\s,;]+/)
    .filter(Boolean);

  for (const raw of tokens) {
    const t = raw.trim().replace(/^slot/i, '');
    const range = t.split('-');
    if (range.length === 2) {
      const a = parseSlot(range[0]);
      const b = parseSlot(range[1]);
      if (a && b) {
        const letter = a.letter || b.letter || 'A';
        const [lo, hi] = a.num <= b.num ? [a.num, b.num] : [b.num, a.num];
        for (let n = lo; n <= hi; n++) add(`${n}${letter}`);
        continue;
      }
    }
    const one = parseSlot(t);
    if (one) {
      const s = `${one.num}${one.letter || 'A'}`;
      if (bySlot.has(s)) { add(s); continue; }
    }
    const lower = t.toLowerCase();
    const found = accounts.filter((a) => a.email === lower || a.slot.toLowerCase() === lower);
    if (found.length === 1) add(found[0].slot);
    else unknown.push(raw);
  }
  return { slots, unknown };
}

/** Compact label for a list of slots: "1A–5A, 3B". */
export function describeSlots(slots) {
  const groups = new Map();
  for (const s of slots) {
    const m = s.match(/^(\d+)([A-Z])$/);
    if (!m) continue;
    if (!groups.has(m[2])) groups.set(m[2], []);
    groups.get(m[2]).push(Number(m[1]));
  }
  const parts = [];
  for (const [letter, nums] of [...groups.entries()].sort()) {
    nums.sort((a, b) => a - b);
    let start = nums[0];
    let prev = nums[0];
    for (let i = 1; i <= nums.length; i++) {
      if (nums[i] === prev + 1) { prev = nums[i]; continue; }
      parts.push(start === prev ? `${start}${letter}` : prev === start + 1 ? `${start}${letter}, ${prev}${letter}` : `${start}${letter}–${prev}${letter}`);
      start = prev = nums[i];
    }
  }
  return parts.join(', ');
}
