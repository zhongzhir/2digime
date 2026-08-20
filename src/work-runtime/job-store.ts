import type { ObjectStore } from '../runtime/ports';
import type { ExecutionJob } from './execution-job';
import { isTerminal } from './execution-job';
import { latestJob } from './derive';

/**
 * JobStore — Job 持久化与按 taskId 的查询辅助。
 * 状态写入仍只能经 Runner 调用 put;本层不做业务转移。
 */
export class JobStore {
  constructor(private readonly store: ObjectStore<ExecutionJob>) {}

  async get(id: string): Promise<ExecutionJob | null> {
    return this.store.get(id);
  }

  async put(job: ExecutionJob): Promise<void> {
    await this.store.put(job);
  }

  async list(): Promise<ExecutionJob[]> {
    return this.store.list();
  }

  async listByTask(taskId: string): Promise<ExecutionJob[]> {
    return this.store.list((job) => job.taskId === taskId);
  }

  async latestForTask(taskId: string): Promise<ExecutionJob | undefined> {
    return latestJob(await this.listByTask(taskId));
  }

  async findActiveForTask(taskId: string): Promise<ExecutionJob | undefined> {
    const jobs = await this.listByTask(taskId);
    return jobs.find((job) => !isTerminal(job.status));
  }
}
