/**
 * Digital Self — 唯一「这个用户的数字之我」权威。
 *
 * 一条 Understanding 就是当前对用户的一条理解，自带最小 provenance。
 * 不是 GrowthEvent、不是 Profile、不是 memory store、也不是 Event/Claim 账本。
 * facet 只用于页面分组，不得作为语义封闭枚举去限制模型理解。
 */

export const DIGITAL_SELF_SCHEMA_VERSION = 1 as const;

export type DigitalSelfOrigin = 'user_statement' | 'material' | 'inference';

export type DigitalSelfStatus =
  | 'current'
  | 'candidate'
  | 'needs_ask'
  | 'superseded'
  | 'deleted';

/** 展示分组。未知值按 about_me 展示，不拒绝写入。 */
export type DigitalSelfFacet =
  | 'about_me'
  | 'goals'
  | 'preferences'
  | 'boundaries'
  | 'context';

export interface DigitalSelfProvenance {
  origin: DigitalSelfOrigin;
  actor: 'owner' | 'model';
  statedAt: string;
  excerpt?: string;
  materialName?: string;
}

export interface Understanding {
  id: string;
  text: string;
  facet: DigitalSelfFacet;
  status: DigitalSelfStatus;
  confirmed: boolean;
  provenance: DigitalSelfProvenance;
  conflictsWithId?: string;
  supersededBy?: string;
  updatedAt: string;
}

export interface DigitalSelf {
  schemaVersion: typeof DIGITAL_SELF_SCHEMA_VERSION;
  subjectId: string;
  updatedAt: string;
  understandings: Understanding[];
}

export interface ModelUnderstandingProposal {
  text: string;
  facet: DigitalSelfFacet;
  aboutUser: boolean;
  origin: DigitalSelfOrigin;
  excerpt?: string;
  isCoreIdentity?: boolean;
  isSensitive?: boolean;
  isMajorGoal?: boolean;
  isBoundary?: boolean;
  mustAsk?: boolean;
  mergeWithId?: string;
  conflictsWithId?: string;
  replacesId?: string;
}

export interface ModelInterpretResult {
  understandings: ModelUnderstandingProposal[];
  notice?: string;
}

export type DigitalSelfAction =
  | 'read'
  | 'tell'
  | 'import'
  | 'confirm'
  | 'correct'
  | 'delete'
  | 'ignore';

export interface DigitalSelfViewItem {
  id: string;
  text: string;
  group: 'about_me' | 'goals' | 'preferences' | 'boundaries' | 'learning';
  sourceLabel: string;
  confirmationLabel: string;
  canConfirm: boolean;
  canIgnore: boolean;
}

export interface DigitalSelfView {
  headline: string;
  empty: boolean;
  notice?: string;
  asked?: boolean;
  groups: {
    about_me: DigitalSelfViewItem[];
    goals: DigitalSelfViewItem[];
    preferences: DigitalSelfViewItem[];
    boundaries: DigitalSelfViewItem[];
    learning: DigitalSelfViewItem[];
  };
}

export interface DigitalSelfCommandInput {
  action: DigitalSelfAction;
  text?: string;
  understandingId?: string;
  filePath?: string;
}

export interface DigitalSelfCommandOutput {
  view: DigitalSelfView;
}
