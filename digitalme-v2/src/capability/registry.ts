import type { CapabilityAdapter } from './adapter';
import { isAdapterType, type CapabilityRegistration } from './registration';

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

  /** 首切片选择器:显式指定优先,否则取第一个可产出目标类型且可用的能力。 */
  selectFor(artifactType: string, explicitId?: string): CapabilityAdapter | undefined {
    if (explicitId) return this.adapters.get(explicitId);
    for (const adapter of this.adapters.values()) {
      const reg = adapter.registration;
      if (reg.availability === 'available' && reg.outputArtifactTypes.includes(artifactType)) {
        return adapter;
      }
    }
    return undefined;
  }
}
