import type { SharedAnnotation } from "../../shared/contracts.ts";
import type { HistoryReplayInput } from "./history-repository.ts";

export type DurableAnnotation = {
  id: string;
  annotationType: SharedAnnotation["type"];
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  color: string;
  label: string | null;
  createdBy: string;
  expiresAt: number | null;
  createdAt: number;
};

export interface AnnotationFogRepository {
  updateStrictMovement(encounterId: string, enabled: boolean, updatedAt: number): Promise<void>;
  updateMapPackage(encounterId: string, serialized: string, updatedAt: number): Promise<void>;
  insertAnnotation(encounterId: string, annotation: DurableAnnotation): Promise<boolean>;
  listDurableAnnotations(encounterId: string): Promise<DurableAnnotation[]>;
  clearDurableAnnotations(encounterId: string): Promise<void>;
  findAnnotation(encounterId: string, annotationId: string): Promise<DurableAnnotation | null>;
  removeAnnotation(encounterId: string, annotationId: string): Promise<boolean>;
  replayHistoryAction(input: HistoryReplayInput): Promise<number>;
}
