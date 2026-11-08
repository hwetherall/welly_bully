// Thin wrappers over the Sprint 2 SQL RPCs (migrations/20261108020359_sprint2-crm-rpcs.sql).
// All RPCs are SECURITY DEFINER and permission-checked server-side; each writes an
// audit_events row. Call via client.database.rpc(name, {...}) as the task spec requires.
import { insforge } from './insforge'
import type { EnquiryStage, InteractionType, MilestoneType } from './crm'

export interface RpcResult<T = unknown> {
  data: T | null
  error: { message: string } | null
}

export function setEnquiryStage(enquiryId: string, stage: EnquiryStage): Promise<RpcResult> {
  return insforge.database.rpc('set_enquiry_stage', { p_enquiry_id: enquiryId, p_stage: stage }) as unknown as Promise<RpcResult>
}

export function completeTask(taskId: string, outcome: string, notes: string | null): Promise<RpcResult> {
  return insforge.database.rpc('complete_task', { p_task_id: taskId, p_outcome: outcome, p_notes: notes }) as unknown as Promise<RpcResult>
}

export function reassignEnquiry(enquiryId: string, newOwner: string): Promise<RpcResult> {
  return insforge.database.rpc('reassign_enquiry', { p_enquiry_id: enquiryId, p_new_owner: newOwner }) as unknown as Promise<RpcResult>
}

export interface LogInteractionInput {
  personId: string
  enquiryId: string
  type: InteractionType
  outcome: string | null
  summary: string
  nextAction: string | null
  nextActionDue: string | null // ISO timestamptz or null
  stage?: EnquiryStage | null
}

export function logInteraction(input: LogInteractionInput): Promise<RpcResult> {
  return insforge.database.rpc('log_interaction', {
    p_person_id: input.personId,
    p_enquiry_id: input.enquiryId,
    p_type: input.type,
    p_outcome: input.outcome,
    p_summary: input.summary,
    p_next_action: input.nextAction,
    p_next_action_due: input.nextActionDue,
    p_stage: input.stage ?? null,
  }) as unknown as Promise<RpcResult>
}

export function recruitmentStats(sinceIso: string): Promise<RpcResult> {
  return insforge.database.rpc('recruitment_stats', { p_since: sinceIso }) as unknown as Promise<RpcResult>
}

/** Direct insert into milestones — RLS allows coordinator/admin (migration 1 policies). */
export function addMilestone(row: {
  person_id: string
  season_id: string
  type: MilestoneType
  recorded_by: string
  notes: string | null
}): Promise<RpcResult> {
  return insforge.database
    .from('milestones')
    .insert([{ ...row, source: 'admin app' }]) as unknown as Promise<RpcResult>
}
