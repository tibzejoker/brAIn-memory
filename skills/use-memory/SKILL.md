---
name: use-memory
description: Store and recall facts the right way. Use whenever you need to remember something for later, or answer from what was remembered before (names, preferences, decisions, ongoing state).
---

# Using memory

Memory is mediated: talk to `memory-proxy`, never to the raw stores.

## Recall (before answering from memory)
1. Ask `memory-proxy` for what's relevant to the current question, in plain language.
2. Wait for its reply, then answer grounded in what came back. Don't assert a remembered fact you didn't get back.

## Store (after learning something durable)
- Store a fact when it's stable and will matter later: a name, a preference, a decision, an ongoing task's state.
- Don't store one-off chatter, secrets the user didn't ask you to keep, or anything you can re-derive cheaply.
- Phrase the stored fact so it's useful out of context ("User prefers metric units", not "yes").

## Pitfalls
- Memory is for facts (the "what"); procedures (the "how") are skills.
- A recall miss means "I don't have it", not "it's false" — say so honestly.
