import { AiBriefSchema } from "../schemas";
import { z } from "zod";
import { callCloudLlm } from "../../llm/cloudLlmClient";

export async function generateBriefsWithOllama(model: string, system: string, prompt: string): Promise<z.infer<typeof AiBriefSchema>[]> {
  // "model" param retained for API compatibility but routing is now via cloudLlmClient
  void model;
  const text = await callCloudLlm(system, prompt, { temperature: 0 });

  // Strip optional markdown code fences that the model may wrap output in
  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  const briefs = JSON.parse(jsonText);
  const validated = z.array(AiBriefSchema).safeParse(briefs);
  if (!validated.success) {
    throw new Error("Invalid brief schema");
  }
  return validated.data;
}
