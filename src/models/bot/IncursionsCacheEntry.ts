import IncursionInfo from "./IncursionInfo";

interface IncursionsCacheEntry {
  createdAt: number;
  updatedAt: number;
  messageId: string;
  incursionInfo: IncursionInfo;
  stateChangeTimestamps?: { [state: string]: string };
}

export default IncursionsCacheEntry;
