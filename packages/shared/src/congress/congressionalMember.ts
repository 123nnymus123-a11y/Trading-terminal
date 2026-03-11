import { z } from "zod";

/**
 * Schema for congressional member metadata (political context).
 */
export const congressionalMemberSchema = z.object({
  id: z.number().int().positive(),
  member_id: z.string().min(1),
  full_name: z.string().min(1).max(200),
  chamber: z.enum(["House", "Senate"]),
  party: z.string().max(50).nullable(),
  state: z.string().max(2).nullable(),
  district: z.string().max(10).nullable(), // For House members
  committee_memberships: z.string().nullable(), // JSON array as string
  leadership_roles: z.string().nullable(), // JSON array as string
  seniority_indicator: z.string().nullable(),
  office_term_start: z.string().nullable(),
  office_term_end: z.string().nullable(),
  bioguide_id: z.string().nullable(),
  last_updated_timestamp: z.string().datetime(),
});

export type CongressionalMember = z.infer<typeof congressionalMemberSchema>;

export const insertCongressionalMemberSchema = congressionalMemberSchema.omit({ id: true });
export type InsertCongressionalMember = z.infer<typeof insertCongressionalMemberSchema>;
