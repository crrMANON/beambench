/**
 * Agent environment backed by a host command client (SDK or MessagePort).
 *
 * Keeps the last known revision in sync with command responses so observe /
 * capture / act all target the same scene version. Scoring stays caller-defined
 * (for example, detector-centre error) so the runner has no physics assumptions.
 */

import type { CommandMethod, CommandResponse } from '../domain/commands';
import type { AgentEnvironment, AgentFrame, AgentObservation } from './runner';
import type { CaptureView } from '../render/capture';

export interface CommandClient {
  /** Send a command at the given revision. */
  request(
    method: CommandMethod,
    args: unknown,
    options?: { expectedRevision?: number }
  ): Promise<CommandResponse>;
}

export interface HostEnvironmentOptions {
  client: CommandClient;
  score: (observation: AgentObservation) => number;
  initialRevision?: number;
}

export class HostAgentEnvironment implements AgentEnvironment {
  private client: CommandClient;
  private scoreFn: (observation: AgentObservation) => number;
  private revision: number;

  constructor(options: HostEnvironmentOptions) {
    this.client = options.client;
    this.scoreFn = options.score;
    this.revision = options.initialRevision ?? 0;
  }

  getRevision(): number {
    return this.revision;
  }

  score(observation: AgentObservation): number {
    return this.scoreFn(observation);
  }

  private track(response: CommandResponse): CommandResponse {
    if (typeof response.revision === 'number') {
      this.revision = response.revision;
    }
    return response;
  }

  async observe(): Promise<AgentObservation> {
    const response = this.track(await this.client.request('observe', null, {
      expectedRevision: this.revision,
    }));
    if (!response.ok) {
      throw new Error(`observe failed: ${response.error ?? 'UNKNOWN'}`);
    }
    return response.result as AgentObservation;
  }

  async capture(view: CaptureView): Promise<AgentFrame> {
    const response = this.track(await this.client.request('capture', { view }, {
      expectedRevision: this.revision,
    }));
    if (!response.ok) {
      throw new Error(`capture failed: ${response.error ?? 'UNKNOWN'}`);
    }
    const frame = response.result as { view: CaptureView; frameId: number; revision: number };
    return {
      revision: frame.revision ?? this.revision,
      view: frame.view ?? view,
      frameId: frame.frameId,
    };
  }

  async execute(method: CommandMethod, args: unknown): Promise<CommandResponse> {
    return this.track(await this.client.request(method, args, {
      expectedRevision: this.revision,
    }));
  }
}
