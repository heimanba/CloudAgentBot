import type { ConnectInput } from "@shared/models";

export interface ConnectionVerifier {
  verify(input: ConnectInput): Promise<void>;
}

export interface ResolvedConnection {
  provider: string;
  credential: string;
  workspaceId?: string;
}
