export interface WorkEpisodeView {
  id: string;
  patientId: string;
  encounterId: string;
  kind: "planned" | "spontaneous" | "alarm";
  title: string;
  state: "active" | "paused" | "completed" | "deferred";
  startedAt: string;
  completedAt: string | null;
  draftText?: string;
  completionEvidence?: string | null;
}

export interface ResponsibilityTransferView {
  id: string;
  patientId: string;
  fromActorId: string;
  toActorId: string;
  reason: string;
  state: "pending" | "acknowledged";
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface WorkdayView {
  sessionId: string;
  stage: "handover" | "plan" | "patient-work" | "reconciliation" | "closed";
  handover: {
    id: string;
    version: number;
    shiftKey: string;
    cutoffAt: string;
    contentHash: string;
    clinicalBound: boolean;
    patientIds: string[];
    items: Array<{
      patientId: string;
      encounterId: string | null;
      currentImportant: string[];
      recentChanges: string[];
      openQuestions: string[];
    }>;
    acknowledgedPatientIds: string[];
    status: "open" | "transferred" | "acknowledged";
    nextResponsibleActorId: string;
  };
  plan: Array<{
    patientId: string;
    title: string;
    reason: string;
    status: "planned" | "active" | "paused" | "completed";
  }>;
  episodes: WorkEpisodeView[];
  activeEpisode: WorkEpisodeView | null;
  resumableEpisode: WorkEpisodeView | null;
  incomingTransfers: ResponsibilityTransferView[];
  outgoingTransfers: ResponsibilityTransferView[];
  providerState: "pending" | "simulated-acknowledged" | "external-gated";
}

export type WorkdayCommand =
  | {
      type: "acknowledge-handover";
      handoverId: string;
      patientId: string;
      version: number;
    }
  | {
      type: "start-episode";
      patientId: string;
      encounterId: string;
      kind: "planned" | "spontaneous" | "alarm";
      title: string;
    }
  | {
      type: "pause-episode";
      episodeId: string;
      reason: "pause" | "interruption";
      draftText?: string;
    }
  | {
      type: "interrupt-and-start";
      episodeId: string;
      patientId: string;
      encounterId: string;
      title: string;
      pausedDraftText?: string;
    }
  | { type: "resume-episode"; episodeId: string }
  | { type: "save-episode-draft"; episodeId: string; draftText: string }
  | {
      type: "defer-responsibility";
      patientId: string;
      encounterId: string;
      reason: string;
      receivingActorId: string;
    }
  | { type: "acknowledge-transfer"; transferId: string }
  | { type: "complete-episode"; episodeId: string; evidence: string }
  | { type: "close-shift" };
