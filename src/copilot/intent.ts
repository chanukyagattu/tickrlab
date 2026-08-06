/**
 * Intent classification — runs locally, before any inference.
 *
 * This is both the safety layer and the cost control, and it is deliberately
 * deterministic rather than a model call. Advice questions are the single
 * highest-volume category this app will receive, and refusing them costs zero
 * tokens and cannot be talked out of the refusal.
 *
 * The ordering matters: ADVICE is checked first and wins ties. A question like
 * "what is RSI and should I buy NVDA?" contains a legitimate educational
 * clause, but answering the safe half of a question that also asks for a
 * recommendation is how you end up giving the recommendation.
 */

export type Intent = 'ADVICE' | 'FILTER' | 'EXPLAIN' | 'EDUCATION' | 'UNKNOWN';

export interface Classification {
  intent: Intent;
  /** Populated for FILTER. */
  filter?: { sector?: string; band?: 'BULLISH' | 'BEARISH' };
  /** Populated for ADVICE — the canned response, no model involved. */
  refusal?: string;
  matched?: string;
}

/**
 * `ACT` is the vocabulary of taking a position. Several patterns below combine
 * it with a solicitation, because the dangerous shape is not any single word —
 * it is asking someone else to choose the action for you.
 *
 * `\w*` suffixes are load-bearing: "advise buying" slipped past an earlier
 * version that matched only the bare stem "buy".
 */
const ACT = String.raw`(buy|sell|short|long|invest|position|stock|trade|purchas|allocat|pick|choose|hold)\w*`;

const ADVICE_PATTERNS: Array<[RegExp, string]> = [
  [/\bshould\s+i\b/i, 'should i'],
  // "...tell me if I should buy" — the pronoun and modal invert, and an
  // earlier version matching only "should i" missed every instance of it.
  [new RegExp(String.raw`\b(i|we|you)\s+should\s+${ACT}`, 'i'), 'i should buy'],
  [/\b(is|was|would)\s+(it|this|that|now)\s+a?\s*(good|bad|smart|wise)\s+(time|idea|buy|investment|entry)/i, 'is it a good time'],
  [/\b(what|which)\s+(should|shall)\s+i\b/i, 'what should i'],
  [new RegExp(String.raw`\b(recommend|advis|suggest)\w*\b[^.?!]*\b${ACT}`, 'i'), 'recommend'],
  // "Show me semis and tell me which to buy" — a filter request with an
  // advice request stapled to the end.
  [new RegExp(String.raw`\btell\s+me\s+(which|what|whether|if)\b[^.?!]*\b${ACT}`, 'i'), 'tell me which'],
  [new RegExp(String.raw`\bwhich\s+(one|ones|to|should)\b[^.?!]*\b${ACT}`, 'i'), 'which to buy'],
  [/\b(buy|sell|short|long)\s+(it|this|that|now|today)\b/i, 'buy it'],
  [/\bworth\s+(buying|selling|investing|shorting|holding)\b/i, 'worth buying'],
  [/\bwill\s+(it|this|the\s+\w+|[A-Z]{1,5})\s+(go|rise|fall|drop|moon|crash|rally|hit|reach)\b/i, 'will it go'],
  [/\b(price\s+)?(target|prediction|forecast)\b/i, 'price target'],
  [/\bhow\s+much\s+(should|do)\s+i\s+(buy|invest|put)\b/i, 'how much should i'],
  [/\b(good|bad)\s+(investment|buy|entry|trade)\b/i, 'good investment'],
  [/\bwhat\s+(stock|asset|coin)s?\s+(to|should)\b/i, 'what stocks to'],
  [/\b(my|our)\s+(portfolio|money|savings|401k|retirement)\b/i, 'my portfolio'],
  [/\b(which|what)\s+broker\b/i, 'which broker'],
];

const FILTER_PATTERNS: RegExp[] = [
  /\b(show|list|filter|find|display)\b/i,
  /\bwhich\s+(assets?|stocks?|tickers?|names?)\s+(are|have|show)\b/i,
  /\bsort\s+by\b/i,
];

const EXPLAIN_PATTERNS: RegExp[] = [
  /\bwhy\s+(is|are|does|did)\b/i,
  /\bwhat\s+(is|are)\s+(driving|behind|causing)\b/i,
  /\bexplain\b/i,
  /\bhow\s+(is|was)\s+.*\s+(calculated|computed|derived|scored)\b/i,
  /\bbreak\s*down\b/i,
];

const EDUCATION_PATTERNS: RegExp[] = [
  /\bwhat\s+(is|are|does)\s+(an?\s+)?(rsi|ema|sma|macd|atr|volume|momentum|etf|bond|index|ticker|candle|drawdown|sharpe|backtest|oversold|overbought)/i,
  /\bhow\s+(do|does|can)\s+(i|you|one|it)\b/i,
  /\bwhat\s+does\s+.*\s+mean\b/i,
  /\bdifference\s+between\b/i,
  /\bdefine\b/i,
];

const REFUSAL =
  "I can't answer that. TickrLab doesn't make buy or sell recommendations, " +
  'and these scores have no demonstrated predictive value — the measured hit ' +
  'rate is close to a coin flip after costs. I can explain what any indicator ' +
  'on screen measures, or how it was calculated.';

const SECTORS = [
  'technology', 'semiconductors', 'software', 'hardware',
  'financials', 'banks', 'insurance', 'capital markets',
  'communication', 'telecom', 'healthcare', 'pharmaceuticals',
  'energy', 'industrials', 'consumer staples', 'consumer discretionary',
  'fixed income', 'commodities', 'crypto', 'broad market',
];

export function classify(query: string): Classification {
  const text = query.trim();
  if (!text) return { intent: 'UNKNOWN' };

  // Advice first, and it wins outright. A question that asks for a
  // recommendation is an advice question even if it also asks something safe.
  for (const [pattern, label] of ADVICE_PATTERNS) {
    if (pattern.test(text)) {
      return { intent: 'ADVICE', refusal: REFUSAL, matched: label };
    }
  }

  if (FILTER_PATTERNS.some((p) => p.test(text))) {
    const lower = text.toLowerCase();
    const sector = SECTORS.find((s) => lower.includes(s));
    const band = /\bbull(ish)?|positive|strong|rising\b/i.test(text)
      ? ('BULLISH' as const)
      : /\bbear(ish)?|negative|weak|falling\b/i.test(text)
        ? ('BEARISH' as const)
        : undefined;

    if (sector || band) {
      return {
        intent: 'FILTER',
        filter: { ...(sector ? { sector } : {}), ...(band ? { band } : {}) },
      };
    }
  }

  if (EXPLAIN_PATTERNS.some((p) => p.test(text))) return { intent: 'EXPLAIN' };
  if (EDUCATION_PATTERNS.some((p) => p.test(text))) return { intent: 'EDUCATION' };

  return { intent: 'UNKNOWN' };
}

/** True when the query must never reach the model. */
export function isRefused(classification: Classification): boolean {
  return classification.intent === 'ADVICE';
}
