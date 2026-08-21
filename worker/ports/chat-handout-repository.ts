import type { Role } from "../../shared/contracts.ts";

export type ChatMessageWrite = {
  id: string;
  encounterId: string;
  senderName: string;
  senderRole: Role;
  recipientName: string | null;
  body: string;
  handoutId: string | null;
  showImmediately: boolean;
  createdAt: number;
};

export type DeletableHandout = {
  id: string;
  displayKey: string;
  thumbnailKey: string;
};

export interface ChatHandoutRepository {
  handoutIsAvailable(encounterId: string, handoutId: string): Promise<boolean>;
  writeChatMessage(message: ChatMessageWrite): Promise<boolean>;
  findDeletableHandout(encounterId: string, handoutId: string): Promise<DeletableHandout | null>;
  countHandoutReferences(encounterId: string, handoutId: string): Promise<number>;
  markHandoutDeleted(encounterId: string, handoutId: string, deletedAt: number): Promise<void>;
}

export interface HandoutObjectStorage {
  available: boolean;
  deleteObjects(keys: string[]): Promise<void>;
}
