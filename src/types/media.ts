export type GsmtcSnapshot = {
  version: number;
  sessions: MediaSessionDto[];
};

export type MediaSessionDto = {
  sourceAppUserModelId: string;
  title: string;
  artist: string;
  album: string;
  subtitle: string;
  playbackStatus: string;
  playbackType: string | null;
  timeline: TimelineDto;
  controls: ControlsDto;
  thumbnailMime: string | null;
  thumbnailBase64: string | null;
};

export type TimelineDto = {
  startTicks: number;
  endTicks: number;
  positionTicks: number;
  minSeekTicks: number;
  maxSeekTicks: number;
  lastUpdatedUnixMs: number;
};

export type ControlsDto = {
  playPauseToggleEnabled: boolean;
  nextEnabled: boolean;
  previousEnabled: boolean;
};
