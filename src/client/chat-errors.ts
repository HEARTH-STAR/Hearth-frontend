// Turn errors and blocked tool calls in plain words. The raw text stays available behind
// "Show details", because it is what a teammate needs to fix the cause.

export interface FriendlyError {
  /** One sentence for anyone: what went wrong. */
  title: string;
  /** What to do about it, when there is something to do. */
  hint?: string;
  /** The original message, shown on request. */
  detail: string;
  /** The fix is on the Dot's Setup page (sign-in, missing agent). */
  setup: boolean;
}

interface Who {
  /** The Dot's name, e.g. "Dora". */
  dot: string;
  /** The Dot's agent, e.g. "Antigravity". */
  agent: string;
}

const RULES: {
  test: RegExp;
  say: (who: Who) => Omit<FriendlyError, 'detail'>;
}[] = [
  {
    test: /invalid model selection|not recognized as a known model|model .* (not found|not available|does not exist)/i,
    say: ({ dot, agent }) => ({
      title: `${dot} couldn’t reply: the AI model it asked ${agent} for isn’t available on this account.`,
      hint: 'Ask your team to update the agent’s model list in Hearth-Core.',
      setup: false,
    }),
  },
  {
    test: /not signed in|sign in|signed out|log ?in required|needs_auth|unauthori[sz]ed|401/i,
    say: ({ dot, agent }) => ({
      title: `${dot} isn’t signed in to ${agent}.`,
      hint: 'Sign in again on its Setup page, then retry.',
      setup: true,
    }),
  },
  {
    test: /cli (not found|unavailable)|binary missing|command not found/i,
    say: ({ dot, agent }) => ({
      title: `${agent} isn’t installed in ${dot}’s computer yet.`,
      hint: 'Open its Setup page; restarting the container installs it.',
      setup: true,
    }),
  },
  {
    test: /rate.?limit|429|quota|usage limit|too many requests|overloaded/i,
    say: () => ({
      title: 'The AI service is busy, or this account reached its usage limit.',
      hint: 'Wait a moment, then retry.',
      setup: false,
    }),
  },
  {
    test: /timed? ?out|timeout|took too long/i,
    say: ({ dot }) => ({
      title: `${dot} took too long to answer.`,
      hint: 'Retry, or ask for a smaller step.',
      setup: false,
    }),
  },
  {
    test: /paused/i,
    say: () => ({
      title: 'All Dots are paused.',
      hint: 'Resume them in Settings to continue.',
      setup: false,
    }),
  },
  {
    test: /container|not running|not ready|starting|ECONNREFUSED|fetch failed|failed to fetch|network|socket|connect/i,
    say: ({ dot }) => ({
      title: `Couldn’t reach ${dot}’s computer.`,
      hint: 'It may be starting up. Retry in a moment.',
      setup: false,
    }),
  },
];

/** A turn's error as a sentence, a next step, and the original text. */
export function describeError(raw: string, who: Who): FriendlyError {
  const detail = raw.trim();
  const rule = RULES.find(({ test }) => test.test(detail));
  return rule
    ? { ...rule.say(who), detail }
    : {
        title: `${who.dot} couldn’t finish that reply.`,
        hint: 'Retry, or rephrase the message.',
        detail,
        setup: false,
      };
}

/**
 * Why a tool call was blocked, for the conversation: Hearth-Core's reasons for the Dot's own
 * switches (commands, file edits) read as the Dot's settings; any other reason stays as given.
 */
export function blockedReason(reason: string | undefined, dot: string) {
  const text = reason?.trim() || '';
  if (/shell commands are switched off|tool Bash is switched off/i.test(text))
    return `Running commands is off for ${dot}, so Hearth blocked this.`;
  if (
    /file edits are switched off|tool (Edit|Write|MultiEdit|NotebookEdit) is switched off/i.test(
      text,
    )
  )
    return `Editing files is off for ${dot}, so Hearth blocked this.`;
  return text || 'Blocked by policy.';
}

/** ``4:12 PM`` today, ``Mon 4:12 PM`` this week, ``Oct 3, 4:12 PM`` before that. */
export function messageTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const clock = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (date.toDateString() === new Date(now).toDateString()) return clock;
  if (now - at < 6 * 24 * 3600 * 1000)
    return `${date.toLocaleDateString([], { weekday: 'short' })} ${clock}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock}`;
}

/** ``0:42``, ``12:05``: how long the Dot has been working. */
export function elapsed(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
