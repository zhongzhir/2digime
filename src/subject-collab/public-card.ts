import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PUBLIC_CARD_SCHEMA_VERSION, type PublicSubjectCard } from './types';

export function publicCardPath(packageRoot: string): string {
  return path.join(packageRoot, 'collaboration', 'public-card.json');
}

export function emptyPublicCard(input: {
  subjectId: string;
  displayName: string;
}): PublicSubjectCard {
  return {
    schemaVersion: PUBLIC_CARD_SCHEMA_VERSION,
    subjectId: input.subjectId,
    displayName: input.displayName,
    endpointRef: `local:${input.subjectId}`,
    publicSkills: [],
    cooperationScope: '低风险知识与判断合作。',
    protocol: '2digime-subject-collab/1',
    reachable: true,
  };
}

export async function readPublicCard(
  packageRoot: string,
  subjectId: string,
  displayName: string,
): Promise<PublicSubjectCard> {
  const file = publicCardPath(packageRoot);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as PublicSubjectCard;
    if (!parsed || parsed.schemaVersion !== PUBLIC_CARD_SCHEMA_VERSION) {
      return emptyPublicCard({ subjectId, displayName });
    }
    return {
      ...parsed,
      subjectId,
      endpointRef: parsed.endpointRef || `local:${subjectId}`,
      publicSkills: Array.isArray(parsed.publicSkills) ? parsed.publicSkills : [],
      protocol: '2digime-subject-collab/1',
      reachable: parsed.reachable !== false,
    };
  } catch {
    return emptyPublicCard({ subjectId, displayName });
  }
}

export async function writePublicCard(
  packageRoot: string,
  card: PublicSubjectCard,
): Promise<void> {
  const file = publicCardPath(packageRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(card, null, 2)}\n`, 'utf8');
}

export function peerCardPath(packageRoot: string, subjectId: string): string {
  const safe = subjectId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(packageRoot, 'collaboration', 'peer-cards', `${safe}.json`);
}

function looksLikePrivateSelf(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.understandings) || typeof raw.subjectId === 'object';
}

export function sanitizePublicCard(
  raw: unknown,
  fallback: { subjectId: string; displayName: string; endpointRef: string },
): PublicSubjectCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Record<string, unknown>;
  if (looksLikePrivateSelf(parsed)) return null;
  if (parsed.schemaVersion !== PUBLIC_CARD_SCHEMA_VERSION) return null;
  const skills = Array.isArray(parsed.publicSkills) ? parsed.publicSkills : [];
  return {
    schemaVersion: PUBLIC_CARD_SCHEMA_VERSION,
    subjectId: fallback.subjectId,
    displayName: String(parsed.displayName || fallback.displayName),
    endpointRef: fallback.endpointRef,
    publicSkills: skills
      .filter((item): item is { name?: unknown; summary?: unknown } => !!item && typeof item === 'object')
      .map((item) => ({
        name: String(item.name || '').trim(),
        summary: String(item.summary || '').trim(),
      }))
      .filter((item) => item.name),
    cooperationScope: String(parsed.cooperationScope || '低风险知识与判断合作。'),
    protocol: '2digime-subject-collab/1',
    reachable: parsed.reachable !== false,
  };
}

export async function writePeerCard(packageRoot: string, card: PublicSubjectCard): Promise<void> {
  const file = peerCardPath(packageRoot, card.subjectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(card, null, 2)}\n`, 'utf8');
}

export async function readPeerCard(
  packageRoot: string,
  subjectId: string,
): Promise<PublicSubjectCard | null> {
  try {
    const raw = JSON.parse(await fs.readFile(peerCardPath(packageRoot, subjectId), 'utf8')) as unknown;
    return sanitizePublicCard(raw, {
      subjectId,
      displayName: subjectId,
      endpointRef: `local:${subjectId}`,
    });
  } catch {
    return null;
  }
}

export function formatPublicCardsForModel(cards: PublicSubjectCard[]): string {
  if (!cards.length) return '当前没有可发现的其他主体。';
  return cards
    .map((card) => {
      const skills = card.publicSkills.length
        ? card.publicSkills.map((s) => `${s.name}：${s.summary}`).join('；')
        : '未声明公开技能';
      return [
        `- subjectId: ${card.subjectId}`,
        `  显示名: ${card.displayName}`,
        `  可达: ${card.reachable ? '是' : '否'}`,
        `  合作范围: ${card.cooperationScope}`,
        `  公开技能: ${skills}`,
      ].join('\n');
    })
    .join('\n');
}
