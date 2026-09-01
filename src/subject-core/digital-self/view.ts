import type {
  DigitalSelf,
  DigitalSelfFacet,
  DigitalSelfView,
  DigitalSelfViewItem,
  Understanding,
} from './types';

const HEADLINE = '2digime 现在怎样理解我';

function sourceLabel(item: Understanding): string {
  if (item.provenance.origin === 'user_statement') return '你亲口说的';
  if (item.provenance.origin === 'material') {
    return item.provenance.materialName
      ? `来自资料「${item.provenance.materialName}」`
      : '来自资料';
  }
  return '2digime 的推断';
}

function confirmationLabel(item: Understanding): string {
  if (item.status === 'needs_ask') return '需要你确认';
  if (item.confirmed && item.status === 'current') return '已确认';
  return '尚未确认';
}

function displayGroup(
  item: Understanding,
): DigitalSelfViewItem['group'] {
  if (item.status === 'candidate' || item.status === 'needs_ask') return 'learning';
  if (item.facet === 'goals' || item.facet === 'context') return 'goals';
  if (item.facet === 'preferences') return 'preferences';
  if (item.facet === 'boundaries') return 'boundaries';
  return 'about_me';
}

function toItem(item: Understanding): DigitalSelfViewItem {
  const group = displayGroup(item);
  return {
    id: item.id,
    text: item.text,
    group,
    sourceLabel: sourceLabel(item),
    confirmationLabel: confirmationLabel(item),
    canConfirm: group === 'learning',
    canIgnore: group === 'learning',
  };
}

export function liveUnderstandings(self: DigitalSelf): Understanding[] {
  return self.understandings.filter(
    (item) =>
      item.status === 'current' ||
      item.status === 'candidate' ||
      item.status === 'needs_ask',
  );
}

export function projectDigitalSelfView(
  self: DigitalSelf,
  extra?: { notice?: string; asked?: boolean },
): DigitalSelfView {
  const live = liveUnderstandings(self).map(toItem);
  const groups: DigitalSelfView['groups'] = {
    about_me: [],
    goals: [],
    preferences: [],
    boundaries: [],
    learning: [],
  };
  for (const item of live) {
    groups[item.group].push(item);
  }
  const empty = live.length === 0;
  return {
    headline: HEADLINE,
    empty,
    ...(extra?.notice ? { notice: extra.notice } : {}),
    ...(extra?.asked ? { asked: true } : {}),
    groups,
  };
}

export function coerceFacet(raw: unknown): DigitalSelfFacet {
  if (raw === 'goals' || raw === 'preferences' || raw === 'boundaries' || raw === 'context') {
    return raw;
  }
  return 'about_me';
}
