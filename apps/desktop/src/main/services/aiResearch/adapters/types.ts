import { AiSourceItem } from "../schemas";

export type IngestResult = {
  items: AiSourceItem[];
  errors: string[];
};

export interface IngestAdapter {
  name: string;
  fetch(): Promise<IngestResult>;
}
