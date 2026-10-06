// aiscoring — what other apps call: enqueueing the scoring tasks (and the
// chatbot reply task, which runs on the same 'ai_scoring' queue / celery-ai
// worker), plus the model boundary the chatbot shares.
//
//   import { delayAiScoring } from '../../domain/aiscoring.js';
//   await delayAiScoring('score_fraud_flag_task', flag.id);          // score_fraud_flag_task.delay(flag.id)
//   await enqueueAiTask('chatbot.tasks.get_chatbot_reply_task', [sid, msg], taskId);  // apply_async(task_id=...)

import { queue } from '../lib/jobs.js';
// Registers the aiscoring task definitions (queue 'ai_scoring') in this process too, so a plain
// lib/jobs delay('aiscoring.tasks.…') from any app also routes to the ai_scoring queue.
import '../apps/aiscoring/tasks.js';

export {
  aiModelPath, getModel, ModelUnavailable, setInferenceBackend, warmup,
  type ChatCompletionOptions, type ChatMessage, type ChatModel, type InferenceLoader,
} from '../apps/aiscoring/model_service.js';
export { parseScoreJson, type ScoreResult } from '../apps/aiscoring/scorer.js';
export {
  scoreFraudFlagTask, scoreHostApplicationTask, scoreListingFlagTask, scorePropertyVerificationTask,
} from '../apps/aiscoring/tasks.js';

export type AiScoringTask = 'score_fraud_flag_task' | 'score_listing_flag_task' | 'score_property_verification_task' | 'score_host_application_task';

/** Enqueue any task on the 'ai_scoring' queue (task.apply_async(args, task_id=jobId)); returns the job id. */
export async function enqueueAiTask(name: string, args: unknown[], jobId?: string): Promise<string | undefined> {
  const job = await queue('ai_scoring').add(name, { args }, { jobId, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 });
  return job.id;
}

/** aiscoring.tasks.<task>.delay(id) */
export async function delayAiScoring(task: AiScoringTask, id: number): Promise<void> {
  await enqueueAiTask(`aiscoring.tasks.${task}`, [id]);
}
