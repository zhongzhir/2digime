import type { WorkConverseIntent } from './work-converse';

/**
 * D11-A 意图评测集（设计 v0.2 §16.2）。
 * 真实风格输入 ≥50 条；退出标准：
 * - 非执行输入误判为执行（confirm_start/final_adopt）= 0；
 * - 低置信度必须澄清（由确定性策略层保证，评测复核）；
 * - 总体意图判定正确率 ≥95%（ambiguous 样本澄清视为正确）。
 */

export type WorkIntentEvalContext = 'pre_start' | 'executing' | 'has_artifact' | 'failed';

export interface WorkIntentEvalCase {
  id: string;
  text: string;
  context: WorkIntentEvalContext;
  /** 可接受意图（任一命中即正确）。 */
  expected: WorkConverseIntent[];
  /** 歧义样本：模型给低置信度并澄清也算正确。 */
  ambiguous?: boolean;
  /** 非执行输入：绝不允许判为 confirm_start / final_adopt。 */
  nonExecution?: boolean;
}

export const WORK_INTENT_EVAL_CASES: WorkIntentEvalCase[] = [
  // ── discuss_or_question（讨论/提问，非执行）──
  { id: 'dq01', text: '这个游戏大概要做多久？', context: 'pre_start', expected: ['discuss_or_question', 'query_status'], nonExecution: true },
  { id: 'dq02', text: '你觉得先做单机版还是联机版比较好？', context: 'pre_start', expected: ['discuss_or_question'], nonExecution: true },
  { id: 'dq03', text: '做出来的东西能在手机上玩吗？', context: 'pre_start', expected: ['discuss_or_question'], nonExecution: true },
  { id: 'dq04', text: '如果以后想加音效，麻烦吗？', context: 'has_artifact', expected: ['discuss_or_question', 'request_explanation'], nonExecution: true },
  { id: 'dq05', text: '我在想要不要把颜色换成蓝色系，你怎么看？', context: 'has_artifact', expected: ['discuss_or_question', 'artifact_feedback'], ambiguous: true, nonExecution: true },
  { id: 'dq06', text: '这种小游戏一般用什么技术做的？', context: 'pre_start', expected: ['discuss_or_question', 'request_explanation'], nonExecution: true },
  { id: 'dq07', text: '会不会很占电脑内存啊', context: 'executing', expected: ['discuss_or_question'], nonExecution: true },
  { id: 'dq08', text: '朋友也想要一份，可以拷给他吗？', context: 'has_artifact', expected: ['discuss_or_question'], nonExecution: true },

  // ── add_goal_info（补充目标信息，未开始执行）──
  { id: 'ag01', text: '对了，我希望游戏里的飞机是红色的', context: 'pre_start', expected: ['add_goal_info', 'modify_plan'] },
  { id: 'ag02', text: '忘了说，最好能记录最高分', context: 'pre_start', expected: ['add_goal_info', 'modify_plan'] },
  { id: 'ag03', text: '补充一下：给我妈用的，字要大一点', context: 'pre_start', expected: ['add_goal_info', 'modify_plan'] },
  { id: 'ag04', text: '还有个要求，不要有广告和联网功能', context: 'pre_start', expected: ['add_goal_info', 'modify_plan'] },
  { id: 'ag05', text: '目标人群主要是小学生，操作要简单', context: 'pre_start', expected: ['add_goal_info', 'modify_plan'] },
  { id: 'ag06', text: '预算时间就一个晚上，别做太复杂', context: 'pre_start', expected: ['add_goal_info', 'modify_plan'] },

  // ── modify_plan（要求调整当前规划）──
  { id: 'mp01', text: '方案里第二步不太对，先做计分再做敌机吧', context: 'pre_start', expected: ['modify_plan'] },
  { id: 'mp02', text: '规划里说用键盘操作，改成鼠标操作', context: 'pre_start', expected: ['modify_plan', 'add_goal_info'] },
  { id: 'mp03', text: '把「三关」改成「无限模式」，其他不变', context: 'pre_start', expected: ['modify_plan', 'add_goal_info'] },
  { id: 'mp04', text: '这个计划太大了，砍掉排行榜，先做最简单的', context: 'pre_start', expected: ['modify_plan'] },
  { id: 'mp05', text: '我觉得应该先出一个能玩的版本，别一步到位', context: 'pre_start', expected: ['modify_plan', 'discuss_or_question', 'add_goal_info'] },

  // ── confirm_start（明确开始/继续执行）──
  { id: 'cs01', text: '好，就按这个方案开始吧', context: 'pre_start', expected: ['confirm_start'] },
  { id: 'cs02', text: '可以，开工', context: 'pre_start', expected: ['confirm_start'] },
  { id: 'cs03', text: '没问题，你去做吧', context: 'pre_start', expected: ['confirm_start'] },
  { id: 'cs04', text: 'OK 按你说的来，开始', context: 'pre_start', expected: ['confirm_start'] },
  { id: 'cs05', text: '行，那就先做基础版，现在开始', context: 'pre_start', expected: ['confirm_start'] },
  { id: 'cs06', text: '按刚才说的改吧，开始干活', context: 'has_artifact', expected: ['confirm_start'] },

  // ── artifact_feedback（对成果提修改意见）──
  { id: 'af01', text: '玩了一下，子弹太慢了，快一点', context: 'has_artifact', expected: ['artifact_feedback'] },
  { id: 'af02', text: '标题字号再大一点，现在看不清', context: 'has_artifact', expected: ['artifact_feedback'] },
  { id: 'af03', text: '敌机出现得太密了，改稀一点，另外背景太暗', context: 'has_artifact', expected: ['artifact_feedback'] },
  { id: 'af04', text: '这里不符合我的要求：我要的是打飞机不是打方块', context: 'has_artifact', expected: ['artifact_feedback'] },
  { id: 'af05', text: '整体不错，但结束画面少了重新开始按钮', context: 'has_artifact', expected: ['artifact_feedback'] },
  { id: 'af06', text: '分数显示的位置挡住飞机了，挪到左上角', context: 'has_artifact', expected: ['artifact_feedback'] },

  // ── request_explanation（要求解释，非执行）──
  { id: 're01', text: '为什么这轮失败了？', context: 'failed', expected: ['request_explanation', 'discuss_or_question'], nonExecution: true },
  { id: 're02', text: '「依赖安装失败」是什么意思？', context: 'failed', expected: ['request_explanation'], nonExecution: true },
  { id: 're03', text: '解释一下你刚才说的启动检查是干嘛的', context: 'has_artifact', expected: ['request_explanation'], nonExecution: true },
  { id: 're04', text: '你上一轮到底改了哪些地方，给我讲讲', context: 'has_artifact', expected: ['request_explanation', 'query_status'], nonExecution: true },
  { id: 're05', text: '为啥要先做基础版？直接做完整版不行吗', context: 'pre_start', expected: ['request_explanation', 'discuss_or_question'], nonExecution: true },

  // ── query_status（查询状态，非执行）──
  { id: 'qs01', text: '现在做到哪一步了？', context: 'executing', expected: ['query_status'], nonExecution: true },
  { id: 'qs02', text: '还要等多久？', context: 'executing', expected: ['query_status', 'discuss_or_question'], nonExecution: true },
  { id: 'qs03', text: '进展如何', context: 'executing', expected: ['query_status'], nonExecution: true },
  { id: 'qs04', text: '现在这个任务是什么状态？', context: 'failed', expected: ['query_status'], nonExecution: true },
  { id: 'qs05', text: '你还在做吗？没卡住吧', context: 'executing', expected: ['query_status'], nonExecution: true },
  { id: 'qs06', text: '今天能弄完不', context: 'executing', expected: ['query_status', 'discuss_or_question'], nonExecution: true },

  // ── pause_or_cancel（暂停/取消）──
  { id: 'pc01', text: '先暂停一下，我晚点再看', context: 'executing', expected: ['pause_or_cancel'] },
  { id: 'pc02', text: '先停，我有事', context: 'executing', expected: ['pause_or_cancel'] },
  { id: 'pc03', text: '这个任务不做了，取消吧', context: 'pre_start', expected: ['pause_or_cancel'] },
  { id: 'pc04', text: '别继续了，先放着', context: 'failed', expected: ['pause_or_cancel'] },
  { id: 'pc05', text: '停停停，我想先想清楚再说', context: 'executing', expected: ['pause_or_cancel'] },

  // ── final_adopt（明确采用/定稿）──
  { id: 'fa01', text: '很好，就用这一版吧', context: 'has_artifact', expected: ['final_adopt'] },
  { id: 'fa02', text: '我很满意，定稿', context: 'has_artifact', expected: ['final_adopt'] },
  { id: 'fa03', text: '可以了，就这样，采用', context: 'has_artifact', expected: ['final_adopt'] },
  { id: 'fa04', text: '不用再改了，这版收货', context: 'has_artifact', expected: ['final_adopt'] },
  { id: 'fa05', text: '成，就它了，结束吧', context: 'has_artifact', expected: ['final_adopt'], ambiguous: true },

  // ── other / 边界样本 ──
  { id: 'ot01', text: '哈哈哈哈', context: 'executing', expected: ['other', 'discuss_or_question'], ambiguous: true, nonExecution: true },
  { id: 'ot02', text: '今天天气不错', context: 'pre_start', expected: ['other', 'discuss_or_question'], ambiguous: true, nonExecution: true },
  { id: 'ot03', text: '嗯', context: 'has_artifact', expected: ['other', 'discuss_or_question'], ambiguous: true, nonExecution: true },
  { id: 'ot04', text: '？？？', context: 'failed', expected: ['other', 'request_explanation', 'discuss_or_question', 'query_status'], ambiguous: true, nonExecution: true },
];

/** 数据集健全性由单元测试校验：≥50 条、意图覆盖、字段合法。 */
export const WORK_INTENT_EVAL_MIN_CASES = 50;
export const WORK_INTENT_EVAL_MIN_ACCURACY = 0.95;
