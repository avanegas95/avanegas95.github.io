// Every user-facing string of the Blob UI. Plain data; types only.
import type { ErrorCode } from "../../lib/chat-events";

type CopyErrorCode = ErrorCode | "network";

export type Message = {
  text: string;
  link?: { label: string; href: "#contact" };
};

export const COPY: {
  greeting: string;
  chips: readonly string[];
  inputLabel: string;
  inputPlaceholder: string;
  send: string;
  clear: string;
  previous: string;
  previousHide: string;
  showMore: string;
  showLess: string;
  disclaimer: { before: string; linkLabel: string; after: string };
  noJs: {
    before: string;
    resume: string;
    middle: string;
    contact: string;
    after: string;
  };
  thinking: string;
  errors: Record<CopyErrorCode, Message>;
} = {
  greeting: "Hi! I'm Blob. Ask me anything about Anderson.",
  chips: [
    "What does he do at Boston Dynamics?",
    "Show me his projects",
    "What's his test automation stack?",
    "Can I get his resume?",
  ],
  inputLabel: "Your question for Blob",
  inputPlaceholder: "Ask about Anderson's work",
  send: "Send",
  clear: "Clear chat",
  previous: "Previous answers",
  previousHide: "Hide previous answers",
  showMore: "Show more",
  showLess: "Show less",
  disclaimer: {
    before: "Blob is an AI and can make mistakes. Ask Anderson directly via ",
    linkLabel: "contact",
    after: ".",
  },
  noJs: {
    before: "Chat needs JavaScript. Here's the ",
    resume: "resume",
    middle: " and ",
    contact: "contact",
    after: ".",
  },
  thinking: "Blob is thinking",
  errors: {
    rate_limited: {
      text: "Whoa, that's a lot of questions! Give Blob a minute, then try again.",
    },
    budget: {
      text: "Blob is napping for today. Anderson is awake, though.",
      link: { label: "Contact him", href: "#contact" },
    },
    bot: {
      text: "Blob couldn't verify this browser. Try reloading the page.",
    },
    upstream: {
      text: "Blob hit a little hiccup. Please try again.",
    },
    network: {
      text: "Blob lost the connection for a moment. Please try again.",
    },
    invalid: {
      text: "That message was too long or a bit odd. Could you rephrase it?",
    },
    unavailable: {
      text: "Blob is offline right now. Anderson is easy to reach, though.",
      link: { label: "Contact him", href: "#contact" },
    },
  },
};
