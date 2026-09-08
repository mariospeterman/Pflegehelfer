export interface WorkEpisodeView {
  id: string;
  patientId: string;
  encounterId: string;
  kind: "planned" | "spontaneous" | "alarm";
  title: string;
  state: "active" | "paused" | "completed" | "deferred";
  startedAt: string;
  completedAt: string | null;
}

export interface WorkdayView {
  sessionId: string;
  stage: "handover" | "plan" | "patient-work" | "reconciliation" | "closed";
  handover: {
    id: string;
    version: number;
    shiftKey: string;
    patientIds: string[];
    acknowledgedPatientIds: string[];
    status: "open" | "transferred" | "acknowledged";
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
  providerState: "pending" | "simulated-acknowledged" | "external-gated";
}

export type WorkdayCommand =
  | { type: "acknowledge-handover"; patientId: string; version: number }
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
    }
  | {
      type: "interrupt-and-start";
      episodeId: string;
      patientId: string;
      encounterId: string;
      title: string;
    }
  | { type: "resume-episode"; episodeId: string }
  | { type: "complete-episode"; episodeId: string; evidence: string }
  | { type: "close-shift" };
