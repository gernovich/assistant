export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
};

export type TranscriptionResult = {
  segments: TranscriptSegment[];
};

export interface TranscriptionProvider {
  id: string;
  transcribe(params: { fileBlob: Blob; fileName: string }): Promise<TranscriptionResult>;
}

