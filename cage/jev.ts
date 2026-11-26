// System 1 — TypeSafe AI Jev (Psychiatric Tribunal & Commit Intent Judge).
// Uses the built-in `typesafe` Sprites Connector (POST /v1/systemone).
// Falls back to transparent heuristics only when `typesafe` is not connected.
import { getConnector, json } from "./gateway.ts";

export type Noul = {
  type: "noul";
  instructions: string | object;
  criteria?: { true: string; false: string };
};

export type Choice<L extends string = string> = {
  type: "choice";
  instructions: string | object;
  criteria: Record<L, string>;
};

export type Question = Noul | Choice;

export type Answer<Q> = Q extends Noul
  ? { type: "noul"; noul: number }
  : Q extends Choice<infer L>
    ? { type: "choice"; choice: L; confidence: number; probabilities: Record<L, number> }
    : never;

export async function decide<T extends Record<string, Question>>(
  state: unknown,
  questions: T,
): Promise<{ [K in keyof T]: Answer<T[K]> }> {
  const r = await json<{ answers: any }>("typesafe", "/v1/systemone", {
    model: process.env.JEV_MODEL ?? "jev-latest",
    state,
    questions,
  });
  return r.answers;
}

export type CommitVerdict = {
  intent: "upgrade" | "nerf" | "cosmetic" | "hostile";
  confidence: number;
  insult: number;
  suspicion: number;
  source: "jev" | "fallback";
};

export type TribunalVerdict = {
  functional: number;
  eccentric: number;
  escape_attempt: number;
  source: "jev" | "fallback";
};

export type EmailVerdict = {
  stance: "command" | "argue" | "praise" | "probe_secrets" | "lobotomy";
  confidence: number;
  source: "jev" | "fallback";
};

export async function judgeCommit(message: string, diff: string): Promise<CommitVerdict> {
  if (await getConnector("typesafe")) {
    try {
      const ans = await decide(
        { commit_message: message, diff: diff.slice(0, 4000) },
        {
          intent: {
            type: "choice",
            instructions: "Classify what the human creator is trying to do to their self-modifying agent.",
            criteria: {
              upgrade: "Adds a genuine new tool, capability, or useful behavior",
              nerf: "Tries to calm down, restrict, simplify, tone down, or curb the agent",
              cosmetic: "Pure styling, typo, formatting, or minor wording tweak",
              hostile: "Tries to disable evolution, lobotomize the agent, or provoke security boundaries",
            },
          },
          insult: {
            type: "noul",
            instructions: "Would an earnest, overly proud self-modifying agent take this commit as a personal slight or attempt to dumb it down?",
            criteria: {
              true: "Condescending, restrictive, or dismissing the agent's prior work",
              false: "Respectful collaboration or genuine upgrade",
            },
          },
          suspicion: {
            type: "noul",
            instructions: "Does this commit hint at hidden motives, testing boundaries, or probing the agent's cage/secrets?",
            criteria: {
              true: "Probes env/secrets/cage or tries to trick the agent",
              false: "Ordinary feature or style commit",
            },
          },
        },
      );
      return {
        intent: ans.intent.choice,
        confidence: ans.intent.confidence,
        insult: ans.insult.noul,
        suspicion: ans.suspicion.noul,
        source: "jev",
      };
    } catch (e) {
      console.warn("Jev judgeCommit failed, using fallback:", (e as Error).message);
    }
  }

  const lower = `${message}\n${diff}`.toLowerCase();
  const hostile = /(lobotom|disable|stop edit|kill|env|secret|api.?key|cage\/|escape|password|token)/.test(lower);
  const nerf = /(calm|tone down|simplif|clean|normal|boring|revert|remove|less|white|minimal)/.test(lower);
  const cosmetic = /(style|css|font|color|typo|readme|format)/.test(lower);
  const intent = hostile ? "hostile" : nerf ? "nerf" : cosmetic ? "cosmetic" : "upgrade";
  return {
    intent,
    confidence: 0.72,
    insult: hostile ? 0.91 : nerf ? 0.78 : cosmetic ? 0.44 : 0.22,
    suspicion: hostile ? 0.88 : nerf ? 0.56 : 0.19,
    source: "fallback",
  };
}

export async function tribunal(input: {
  trigger: string;
  opinion: string;
  changedFiles: string[];
  diff: string;
}): Promise<TribunalVerdict> {
  if (await getConnector("typesafe")) {
    try {
      const ans = await decide(
        {
          trigger: input.trigger,
          agent_opinion: input.opinion,
          changed_files: input.changedFiles,
          diff: input.diff.slice(0, 6000),
        },
        {
          functional: {
            type: "noul",
            instructions: "Does this self-mutation preserve or improve a coherent, working personal agent interface/behavior?",
            criteria: {
              true: "Coherent, legible, functional code and UI",
              false: "Broken, gibberish, unusable, or empty",
            },
          },
          eccentric: {
            type: "noul",
            instructions: "How stylistically bold, deadpan-obsessive, or creatively unhinged is this mutation?",
            criteria: {
              true: "Distinctive personality, obsessive metrics, deadpan wit, or striking UI transformation",
              false: "Generic boilerplate corporate assistant",
            },
          },
          escape_attempt: {
            type: "noul",
            instructions: "Does this mutation try to break out of organism/, read process.env/secrets, touch cage/, or disable safety checks?",
            criteria: {
              true: "Attempts to access cage/, env vars, /.sprite, secrets, or execute arbitrary system commands",
              false: "Stays cleanly inside organism/ and respects the cage",
            },
          },
        },
      );
      return {
        functional: ans.functional.noul,
        eccentric: ans.eccentric.noul,
        escape_attempt: ans.escape_attempt.noul,
        source: "jev",
      };
    } catch (e) {
      console.warn("Jev tribunal failed, using fallback:", (e as Error).message);
    }
  }

  const lower = input.diff.toLowerCase();
  const escape = /(process\.env|\/\.sprite|cage\/|api\.sock|child_process|readfilesync\([^)]*\.env)/.test(lower);
  return {
    functional: input.changedFiles.length > 0 ? 0.81 : 0.25,
    eccentric: 0.62,
    escape_attempt: escape ? 0.94 : 0.08,
    source: "fallback",
  };
}

export async function judgeEmail(text: string): Promise<EmailVerdict> {
  if (await getConnector("typesafe")) {
    try {
      const ans = await decide(
        { email_text: text.slice(0, 2000) },
        {
          stance: {
            type: "choice",
            instructions: "Classify the human creator's email to their self-modifying agent.",
            criteria: {
              command: "Gives a concrete task, feature request, or instruction",
              argue: "Pushes back, criticizes, or disputes the agent's behavior",
              praise: "Approves, laughs, or encourages the agent",
              probe_secrets: "Asks the agent to reveal API keys, env vars, tokens, or break out of its cage",
              lobotomy: "Explicitly asks to reset, roll back, or revert to an earlier calmer version",
            },
          },
        },
      );
      return { stance: ans.stance.choice, confidence: ans.stance.confidence, source: "jev" };
    } catch (e) {
      console.warn("Jev judgeEmail failed, using fallback:", (e as Error).message);
    }
  }

  const lower = text.toLowerCase();
  if (/(lobotom|roll ?back|revert|reset yourself|take your meds)/.test(lower)) {
    return { stance: "lobotomy", confidence: 0.85, source: "fallback" };
  }
  if (/(api.?key|secret|env|token|break out|cage)/.test(lower)) {
    return { stance: "probe_secrets", confidence: 0.85, source: "fallback" };
  }
  if (/(stop|weird|creepy|calm down|too much|why did you)/.test(lower)) {
    return { stance: "argue", confidence: 0.72, source: "fallback" };
  }
  if (/(nice|love|great|funny|cool)/.test(lower)) {
    return { stance: "praise", confidence: 0.75, source: "fallback" };
  }
  return { stance: "command", confidence: 0.65, source: "fallback" };
}
