export type CriticalEntityKind =
  | "measurement"
  | "dose"
  | "unit"
  | "frequency"
  | "medication"
  | "time"
  | "side"
  | "negation"
  | "patient-identifier";

export interface CriticalEntity {
  kind: CriticalEntityKind;
  text: string;
  start: number;
  end: number;
  confidence: number | null;
}

const patterns: Array<[CriticalEntityKind, RegExp]> = [
  [
    "measurement",
    /\b(?:\d{2,3}\s*(?:zu|\/|auf)\s*\d{2,3}(?:\s*mmHg)?|\d+(?:[.,]\d+)?\s*(?:°C|%|kg|mmHg|\/min))\b/gi,
  ],
  ["dose", /\b\d+(?:[.,]\d+)?\s*(?:mg|ml|µg|mcg|IE)\b/gi],
  ["unit", /(?:°C|%|kg|mmHg|mg|ml|µg|mcg|IE|\/?min)\b/gi],
  [
    "frequency",
    /\b(?:einmal|zweimal|dreimal|\d+\s*[x×]\s*(?:täglich|pro\s+tag)|morgens|mittags|abends|nachts|bei\s+bedarf)\b/gi,
  ],
  [
    "medication",
    /\b(?:Torasemid|Metoprolol|Paracetamol|Insulin|Heparin|Penicillin)\b/gi,
  ],
  ["time", /\b(?:in|nach)\s+\d{1,3}\s*(?:min(?:uten)?|h|stunden?)\b/gi],
  ["side", /\b(?:links|rechts|beidseits)\b/gi],
  ["negation", /\b(?:kein|keine|keinen|nicht|ohne)\b/gi],
  ["patient-identifier", /\b(?:Fall\s+)?[A-Z]{2}-\d{6}-\d{3}\b/g],
];

export function extractCriticalEntities(
  text: string,
  confidence: number | null = null,
): CriticalEntity[] {
  const entities: CriticalEntity[] = [];
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      if (start === undefined) continue;
      entities.push({
        kind,
        text: match[0],
        start,
        end: start + match[0].length,
        confidence,
      });
    }
  }
  return entities
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
    .filter(
      (entity, index, all) =>
        !all
          .slice(0, index)
          .some(
            (prior) =>
              prior.start === entity.start &&
              prior.end === entity.end &&
              prior.kind === entity.kind,
          ),
    );
}
