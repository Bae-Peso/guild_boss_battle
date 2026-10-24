import { supabase } from './supabase';

export async function logAudit(guildId, actorId, actionType, description) {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      union_id: guildId,
      actor_id: actorId,
      action_type: actionType,
      description: description
    });
    if (error) {
      console.error('Audit log failed:', error);
    }
  } catch (err) {
    console.error('Audit log exception:', err);
  }
}
