export interface SourceBoundAtom {
  text: string;
  /** The row-specific concept, such as a task title or observation label. */
  entityLabels?: readonly string[];
  /** The subject shared by rows, such as the patient label. */
  subjectLabels?: readonly string[];
}

function normalizedText(text: string): string {
  return text.toLocaleLowerCase("de-CH").normalize("NFKC");
}

function containsBoundedPhrase(text: string, phrase: string): boolean {
  const normalized = normalizedText(text);
  const normalizedPhrase = normalizedText(phrase).trim();
  if (normalizedPhrase.length < 2) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\d])${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\d])`,
    "iu",
  ).test(normalized);
}

function significantWords(text: string): string[] {
  return [...normalizedText(text).matchAll(/[\p{L}\d]+/gu)]
    .map(([word]) => word)
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word));
}

function referencesLabel(text: string, label: string): boolean {
  if (containsBoundedPhrase(text, label)) return true;
  const words = significantWords(label);
  if (words.length === 0) return false;
  const normalized = normalizedText(text);
  const matches = words.filter((word) =>
    containsBoundedPhrase(normalized, word),
  );
  return matches.length >= Math.min(2, words.length);
}

function isLocallyNegated(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 36), matchIndex);
  return /\b(?:nicht|nie|kein(?:e|en|er|es)?)\s+(?:\p{L}+\s+){0,2}$/iu.test(
    prefix,
  );
}

export function canonicalClaimTokens(text: string): string[] {
  const normalized = normalizedText(text).replace(/,/g, ".");
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/\b\d+(?:[./]\d+)?\b/gu))
    tokens.add(match[0]);

  if (
    /\b(?:offen\p{L}*|steht noch aus|angenommen|wartend)\b/iu.test(normalized)
  )
    tokens.add("state:open");
  for (const match of normalized.matchAll(
    /\b(?:erledigt|abgeschlossen)\b/giu,
  )) {
    if (isLocallyNegated(normalized, match.index)) tokens.add("state:open");
    else tokens.add("state:completed");
  }

  const groups: Array<[RegExp, string]> = [
    [/\b(?:in arbeit|begonnen)\b/iu, "state:in-progress"],
    [/\b(?:pausiert|unterbrochen)\b/iu, "state:paused"],
    [/\b(?:blutdruck|rr)\b/iu, "concept:blood-pressure"],
    [/\b(?:temperatur|temp\.?|grad)\b|°c/iu, "concept:temperature"],
    [/\b(?:puls|herzfrequenz)\b|\/min/iu, "concept:pulse"],
    [/\b(?:sauerstoff|sättigung|saettigung|spo₂|spo2)\b|%/iu, "concept:oxygen"],
    [/\bgewicht\b|\bkg\b/iu, "concept:weight"],
  ];
  for (const [pattern, token] of groups)
    if (pattern.test(normalized)) tokens.add(token);
  return [...tokens];
}

function atomClaimTokens(atom: SourceBoundAtom): Set<string> {
  return new Set(canonicalClaimTokens(atom.text));
}

function matchingRows(
  clause: string,
  atoms: readonly SourceBoundAtom[],
): readonly SourceBoundAtom[] {
  const entityMatches = atoms.filter((atom) =>
    (atom.entityLabels ?? []).some((label) => referencesLabel(clause, label)),
  );
  if (entityMatches.length > 0) return entityMatches;

  const subjectMatches = atoms.filter((atom) =>
    (atom.subjectLabels ?? []).some((label) => referencesLabel(clause, label)),
  );
  return subjectMatches.length > 0 ? subjectMatches : atoms;
}

export function clauseIsSupportedBySource(
  clause: string,
  atoms: readonly SourceBoundAtom[],
  protectedTerms: readonly string[],
): boolean {
  const materialTokens = canonicalClaimTokens(clause);
  const hasPatientTerm = protectedTerms.some((term) =>
    containsBoundedPhrase(clause, term),
  );
  const hasCurrentMeasurementClaim =
    /\b(?:aktuell|jetzt|derzeit|momentan)\b/iu.test(clause) &&
    materialTokens.length > 0;
  if (hasCurrentMeasurementClaim) return false;
  if (materialTokens.length === 0 && !hasPatientTerm) return true;

  return matchingRows(clause, atoms).some((atom) => {
    const available = atomClaimTokens(atom);
    const supportsTokens = materialTokens.every((token) =>
      available.has(token),
    );
    const supportsPatient =
      !hasPatientTerm ||
      protectedTerms.some(
        (term) =>
          containsBoundedPhrase(clause, term) &&
          (atom.subjectLabels ?? []).some((label) =>
            containsBoundedPhrase(label, term),
          ),
      );
    return supportsTokens && supportsPatient;
  });
}

export function verifyNaturalDialogueAgainstSources(
  text: string,
  atoms: readonly SourceBoundAtom[],
  protectedTerms: readonly string[],
): string | null {
  const dialogue = text.trim();
  if (dialogue.length === 0 || dialogue.length > 1_200) return null;
  const clauses = dialogue
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (
    clauses.length === 0 ||
    clauses.some(
      (clause) => !clauseIsSupportedBySource(clause, atoms, protectedTerms),
    )
  )
    return null;
  return clauses.join(" ");
}
