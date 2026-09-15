export const completedOpenUi = [
  "root = ClinicalStack([item0])",
  'item0 = ClinicalCard("neutral", "Ausgeführt", "Die einzeln geprüften Angaben sind lokal freigegeben und werden nachvollziehbar synchronisiert.", "Lokaler Eingang · Synchronisierungsstatus sichtbar")',
].join("\n");

export const supersededOpenUi = [
  "root = ClinicalStack([item0])",
  'item0 = ClinicalCard("neutral", "Korrektur übernommen", "Korrektur übernommen. Diese frühere Auswahl ist nicht mehr gültig.", "Frühere Fassung · nur zur Nachvollziehbarkeit")',
].join("\n");
