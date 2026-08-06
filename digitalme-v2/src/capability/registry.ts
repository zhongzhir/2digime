import type { CapabilityAdapter } from './adapter';
import { isAdapterType, type CapabilityRegistration } from './registration';
import type { MaterialKind, TaskIntentKind } from '../work-runtime/work-intent';
import {
  CODE_ANALYSIS_ARTIFACT_TYPE,
  CODE_REPO_ANALYSIS_CAPABILITY_ID,
} from './adapters/code-repo-analysis-contract';

export interface CapabilityNeed {
  intentKind?: TaskIntentKind;
  expectedOutputFamily?: string;
  materialKinds?: readonly MaterialKind[];
  explicitCapabilityId?: string;
}

export interface CapabilitySelectResult {
  adapter?: CapabilityAdapter;
  reason:
    | 'explicit'
    | 'intent_material'
    | 'output_family'
    | 'document_fallback'
    | 'none';
  /** 用户可行动说明（能力不可用或无法匹配时）。 */
  actionable?: string;
}

/**
 * 能力注册表 — Work Runtime 经此选择能力;主链对能力种类零感知。
 * 注册时校验 adapter.type 属于代码白名单(registration.ts ADAPTER_TYPES)。
 */
export class CapabilityRegistry {
  private readonly adapters = new Map<string, CapabilityAdapter>();

  register(adapter: CapabilityAdapter): void {
    const reg = adapter.registration;
    if (!isAdapterType(reg.adapter.type)) {
      throw new Error(`capability ${reg.id} declares non-whitelisted adapter type: ${reg.adapter.type}`);
    }
    if (this.adapters.has(reg.id)) {
      throw new Error(`capability ${reg.id} already registered`);
    }
    this.adapters.set(reg.id, adapter);
  }

  get(id: string): CapabilityAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): CapabilityRegistration[] {
    return [...this.adapters.values()].map((a) => a.registration);
  }

  /**
   * 兼容包装：按产出族 + 显式 ID 选择。
   * 新代码应优先 selectForNeed。
   */
  selectFor(artifactType: string, explicitId?: string): CapabilityAdapter | undefined {
    const result = this.selectForNeed({
      expectedOutputFamily: artifactType,
      ...(explicitId ? { explicitCapabilityId: explicitId } : {}),
    });
    return result.adapter;
  }

  /**
   * 能力选择合同：
   * 1) 显式指定且可用
   * 2) 高置信意图+材料命中
   * 3) 期望成果族匹配
   * 4) 文档能力兼容回退（analyze_code 禁止回退伪装）
   */
  selectForNeed(need: CapabilityNeed): CapabilitySelectResult {
    const explicitId = String(need.explicitCapabilityId || '').trim();
    if (explicitId) {
      const adapter = this.adapters.get(explicitId);
      if (!adapter) {
        return {
          reason: 'none',
          actionable: '指定的能力不可用，请改用其他方式或稍后再试。',
        };
      }
      if (adapter.registration.availability !== 'available') {
        return {
          reason: 'none',
          actionable: actionableForUnavailable(adapter.registration, need.intentKind),
        };
      }
      return { adapter, reason: 'explicit' };
    }

    const intent = need.intentKind;
    const family = String(need.expectedOutputFamily || '').trim();
    const materials = need.materialKinds ?? [];

    if (intent === 'analyze_code' || family === CODE_ANALYSIS_ARTIFACT_TYPE) {
      const code = this.adapters.get(CODE_REPO_ANALYSIS_CAPABILITY_ID);
      const byFamily = code
        ? code
        : [...this.adapters.values()].find((a) =>
            a.registration.outputArtifactTypes.includes(CODE_ANALYSIS_ARTIFACT_TYPE),
          );
      if (!byFamily) {
        return {
          reason: 'none',
          actionable: '当前没有可用的代码分析能力。请先连接模型后再试，或改用其他任务。',
        };
      }
      if (byFamily.registration.availability !== 'available') {
        return {
          reason: 'none',
          actionable: actionableForUnavailable(byFamily.registration, 'analyze_code'),
        };
      }
      const hasCodeMaterial =
        materials.includes('code_repo') ||
        materials.includes('folder') ||
        materials.some((m) => m === 'file');
      if (intent === 'analyze_code' && materials.length > 0 && !hasCodeMaterial) {
        return {
          reason: 'none',
          actionable: '代码分析需要你添加代码文件夹或项目文件。',
        };
      }
      // 意图+材料共同命中
      if (
        intent === 'analyze_code' &&
        (materials.includes('code_repo') || materials.includes('folder'))
      ) {
        return { adapter: byFamily, reason: 'intent_material' };
      }
      if (family === CODE_ANALYSIS_ARTIFACT_TYPE) {
        return { adapter: byFamily, reason: 'output_family' };
      }
      return { adapter: byFamily, reason: 'intent_material' };
    }

    if (family) {
      for (const adapter of this.adapters.values()) {
        const reg = adapter.registration;
        if (
          reg.availability === 'available' &&
          reg.outputArtifactTypes.includes(family)
        ) {
          return { adapter, reason: 'output_family' };
        }
      }
    }

    // 文档兼容回退（禁止用于 analyze_code —— 上方已 return）
    for (const adapter of this.adapters.values()) {
      const reg = adapter.registration;
      if (reg.availability === 'available' && reg.outputArtifactTypes.includes('document')) {
        return { adapter, reason: 'document_fallback' };
      }
    }

    return {
      reason: 'none',
      actionable: '当前没有可用的处理能力。请先连接模型后再试。',
    };
  }
}

function actionableForUnavailable(
  reg: CapabilityRegistration,
  intent?: TaskIntentKind,
): string {
  if (intent === 'analyze_code' || reg.outputArtifactTypes.includes(CODE_ANALYSIS_ARTIFACT_TYPE)) {
    if (reg.availability === 'needs_setup') {
      return '当前无法进行代码分析：请先连接模型后再试。不会改用普通写作冒充代码审查。';
    }
    return '代码分析能力暂时不可用，请稍后重试。不会改用普通写作冒充代码审查。';
  }
  if (reg.availability === 'needs_setup') {
    return '请先连接模型后再试。';
  }
  return '所选能力暂时不可用，请稍后重试。';
}
